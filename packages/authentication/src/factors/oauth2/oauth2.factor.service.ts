import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { CacheProvider } from '@maroonedsoftware/cache';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { OAuth2Profile, OAuth2ProviderRegistry } from '../../providers/oauth2.provider.js';
import { OAuth2Factor, OAuth2FactorRepository } from './oauth2.factor.repository.js';

/**
 * Result of a successful OAuth 2.0 authorization callback. Same shape as
 * {@link OidcAuthorizationResult} so apps can share callback handling logic.
 *
 * `emailConflict` only fires when the provider returns an email it claims is
 * verified-but-unverified-elsewhere; most OAuth 2.0 providers don't expose
 * verification state, in which case `emailVerified` defaults to `false` and
 * the conflict path is the safer default.
 */
export type OAuth2AuthorizationResult =
  | {
      kind: 'signed-in';
      actorId: string;
      factorId: string;
      profile: OAuth2Profile;
      redirectAfter?: string;
    }
  | {
      kind: 'linked';
      actorId: string;
      factorId: string;
      profile: OAuth2Profile;
      redirectAfter?: string;
    }
  | {
      kind: 'new-user';
      authorizationId: string;
      profile: OAuth2Profile;
      emailConflict?: { actorId: string; reason: 'unverified-email' };
      redirectAfter?: string;
    };

type StoredAuthorizationState = {
  provider: string;
  state: string;
  codeVerifier: string | null;
  intent: 'sign-in' | 'link';
  actorId?: string;
  redirectAfter?: string;
  issuedAt: number;
  expiresAt: number;
};

type StoredPendingAuthorization = {
  authorizationId: string;
  provider: string;
  profile: OAuth2Profile;
  refreshToken?: string;
  refreshTokenExpiresAt?: number | null;
  redirectAfter?: string;
  expiresAt: number;
};

/**
 * Implemented by the consuming app to bridge OAuth 2.0 sign-in to whatever
 * primary-account lookup it uses. See {@link OidcActorEmailLookup} — same contract,
 * separate type so the two factor services can be wired up independently.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface OAuth2ActorEmailLookup {
  findActorByEmail(email: string): Promise<string | undefined>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class OAuth2ActorEmailLookup implements OAuth2ActorEmailLookup {}

/** Configuration options for {@link OAuth2FactorService}. */
@Injectable()
export class OAuth2FactorServiceOptions {
  constructor(
    public readonly stateExpiration: Duration = Duration.fromDurationLike({ minutes: 10 }),
    public readonly pendingAuthorizationExpiration: Duration = Duration.fromDurationLike({ minutes: 30 }),
  ) {}
}

/**
 * Orchestrates OAuth 2.0 (non-OIDC) sign-in and account linking flows.
 *
 * Mirrors {@link OidcFactorService}'s public surface so apps can swap or layer
 * the two. Differences from OIDC:
 *
 * - No id_token, no nonce — the provider's userinfo endpoint is the source of truth.
 * - PKCE is opt-in per provider (some, like GitHub, don't support it).
 * - Email verification status is provider-specific; default to `false` rather than `undefined`.
 */
@Injectable()
export class OAuth2FactorService {
  constructor(
    private readonly options: OAuth2FactorServiceOptions,
    private readonly registry: OAuth2ProviderRegistry,
    private readonly repo: OAuth2FactorRepository,
    private readonly emailLookup: OAuth2ActorEmailLookup,
    private readonly cache: CacheProvider,
    private readonly encryption: EncryptionProvider,
    private readonly logger: Logger,
  ) {}

  private getStateKey(state: string) {
    return `oauth2_state_${state}`;
  }

  private getAuthorizationKey(authorizationId: string) {
    return `oauth2_authorization_${authorizationId}`;
  }

  /**
   * Build the provider authorize URL and cache the state record for the round-trip.
   */
  async beginAuthorization(args: {
    provider: string;
    intent: 'sign-in' | 'link';
    actorId?: string;
    redirectAfter?: string;
  }): Promise<{ url: URL; state: string; expiresAt: DateTime }> {
    if (args.intent === 'link' && !args.actorId) {
      throw httpError(400).withDetails({ actorId: 'required when intent is link' });
    }

    const config = this.registry.getConfig(args.provider);
    const state = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = config.usesPKCE ? crypto.randomBytes(32).toString('base64url') : null;

    const url = config.client.createAuthorizationURL(state, codeVerifier, config.scopes);

    const issuedAt = DateTime.utc();
    const expiresAt = issuedAt.plus(this.options.stateExpiration);

    const stored: StoredAuthorizationState = {
      provider: args.provider,
      state,
      codeVerifier,
      intent: args.intent,
      actorId: args.actorId,
      redirectAfter: args.redirectAfter,
      issuedAt: issuedAt.toUnixInteger(),
      expiresAt: expiresAt.toUnixInteger(),
    };

    await this.cache.set(this.getStateKey(state), JSON.stringify(stored), this.options.stateExpiration);

    return { url, state, expiresAt };
  }

  /**
   * Exchange the authorization code, fetch the provider profile, and resolve to a factor.
   *
   * @throws HTTP 400 when `state` or `code` is missing.
   * @throws HTTP 404 when the state record has expired or `state` doesn't match.
   */
  async completeAuthorization(args: { callbackUrl: URL }): Promise<OAuth2AuthorizationResult> {
    const callbackState = args.callbackUrl.searchParams.get('state');
    const code = args.callbackUrl.searchParams.get('code');
    if (!callbackState) {
      throw httpError(400).withDetails({ state: 'missing from callback' });
    }
    if (!code) {
      throw httpError(400).withDetails({ code: 'missing from callback' });
    }

    const stored = await this.lookupState(callbackState);
    if (!stored) {
      throw httpError(404).withDetails({ state: 'not found or expired' });
    }
    await this.cache.delete(this.getStateKey(callbackState));

    const config = this.registry.getConfig(stored.provider);
    const tokens = await config.client.validateAuthorizationCode(code, stored.codeVerifier);

    let rawProfile: Omit<OAuth2Profile, 'provider'>;
    try {
      rawProfile = await config.fetchProfile(tokens.accessToken);
    } catch (error) {
      this.logger.error('OAuth2 profile fetch failed', { provider: stored.provider, error });
      throw httpError(502)
        .withDetails({ provider: 'profile fetch failed' })
        .withCause(error as Error);
    }

    const profile: OAuth2Profile = { ...rawProfile, provider: stored.provider };
    const refreshToken = config.persistRefreshToken && config.client.refreshAccessToken ? tokens.refreshToken : undefined;
    const refreshTokenExpiresAt = tokens.expiresAt ?? null;

    // 1. Existing factor for (provider, subject) → signed-in
    const existing = await this.repo.lookupFactor({ provider: stored.provider, subject: profile.subject });
    if (existing) {
      if (refreshToken) {
        const { encryptedValue, encryptedDek } = this.encryption.encryptWithNewDek(refreshToken);
        await this.repo.updateRefreshToken(existing.id, {
          encryptedRefreshToken: encryptedValue,
          encryptedRefreshTokenDek: encryptedDek,
          refreshTokenExpiresAt,
        });
      }
      if (profile.email && profile.email !== existing.email) {
        await this.repo.updateEmail(existing.id, profile.email);
      }
      return {
        kind: 'signed-in',
        actorId: existing.actorId,
        factorId: existing.id,
        profile,
        redirectAfter: stored.redirectAfter,
      };
    }

    // 2. Explicit link
    if (stored.intent === 'link') {
      const factor = await this.createFactor(stored.actorId!, profile, refreshToken, refreshTokenExpiresAt);
      return { kind: 'linked', actorId: factor.actorId, factorId: factor.id, profile, redirectAfter: stored.redirectAfter };
    }

    // 3. Auto-link by verified email
    if (profile.email && profile.emailVerified === true) {
      const matchedActorId = await this.emailLookup.findActorByEmail(profile.email);
      if (matchedActorId) {
        const factor = await this.createFactor(matchedActorId, profile, refreshToken, refreshTokenExpiresAt);
        return { kind: 'linked', actorId: factor.actorId, factorId: factor.id, profile, redirectAfter: stored.redirectAfter };
      }
    }

    // 4. Email matches but unverified — surface conflict
    let emailConflict: { actorId: string; reason: 'unverified-email' } | undefined;
    if (profile.email && profile.emailVerified !== true) {
      const matchedActorId = await this.emailLookup.findActorByEmail(profile.email);
      if (matchedActorId) {
        emailConflict = { actorId: matchedActorId, reason: 'unverified-email' };
      }
    }

    // 5. Genuine new user
    const authorizationId = await this.cachePendingAuthorization({
      provider: stored.provider,
      profile,
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt instanceof Date ? Math.floor(refreshTokenExpiresAt.getTime() / 1000) : null,
      redirectAfter: stored.redirectAfter,
    });

    return { kind: 'new-user', authorizationId, profile, emailConflict, redirectAfter: stored.redirectAfter };
  }

  /**
   * Complete the `new-user` branch by attaching the cached profile to a freshly
   * created actor.
   */
  async createFactorFromAuthorization(actorId: string, authorizationId: string): Promise<OAuth2Factor> {
    const pending = await this.lookupPendingAuthorization(authorizationId);
    if (!pending) {
      throw httpError(404).withDetails({ authorizationId: 'not found or expired' });
    }
    await this.cache.delete(this.getAuthorizationKey(authorizationId));

    const refreshTokenExpiresAt =
      pending.refreshTokenExpiresAt === null
        ? null
        : pending.refreshTokenExpiresAt !== undefined
          ? new Date(pending.refreshTokenExpiresAt * 1000)
          : undefined;

    return this.createFactor(actorId, pending.profile, pending.refreshToken, refreshTokenExpiresAt);
  }

  /**
   * Refresh the access token using the persisted refresh token. Requires the
   * adapter to implement `refreshAccessToken` and `persistRefreshToken: true`
   * on the provider config.
   */
  async refreshAccessToken(
    actorId: string,
    factorId: string,
  ): Promise<{
    accessToken: string;
    expiresAt: Date | null;
    scopes?: string[];
    idToken?: string;
  }> {
    const factor = await this.repo.getFactor(actorId, factorId);
    if (!factor.encryptedRefreshToken || !factor.encryptedRefreshTokenDek) {
      throw httpError(404).withDetails({ refreshToken: 'no refresh token persisted for factor' });
    }

    const config = this.registry.getConfig(factor.provider);
    if (!config.client.refreshAccessToken) {
      throw httpError(400).withDetails({ provider: 'adapter does not support refresh' });
    }

    const refreshToken = this.encryption.decryptWithDek(factor.encryptedRefreshToken, factor.encryptedRefreshTokenDek);
    const tokens = await config.client.refreshAccessToken(refreshToken);

    if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
      const { encryptedValue, encryptedDek } = this.encryption.encryptWithNewDek(tokens.refreshToken);
      await this.repo.updateRefreshToken(factor.id, {
        encryptedRefreshToken: encryptedValue,
        encryptedRefreshTokenDek: encryptedDek,
        refreshTokenExpiresAt: tokens.expiresAt ?? null,
      });
    }

    return {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt ?? null,
      scopes: tokens.scopes,
      idToken: tokens.idToken,
    };
  }

  async hasPendingAuthorization(authorizationId: string): Promise<boolean> {
    return (await this.lookupPendingAuthorization(authorizationId)) !== undefined;
  }

  private async createFactor(
    actorId: string,
    profile: OAuth2Profile,
    refreshToken: string | undefined,
    refreshTokenExpiresAt: Date | null | undefined,
  ): Promise<OAuth2Factor> {
    let encryptedRefreshToken: string | undefined;
    let encryptedRefreshTokenDek: string | undefined;
    if (refreshToken) {
      const { encryptedValue, encryptedDek } = this.encryption.encryptWithNewDek(refreshToken);
      encryptedRefreshToken = encryptedValue;
      encryptedRefreshTokenDek = encryptedDek;
    }
    return this.repo.createFactor(actorId, {
      provider: profile.provider,
      subject: profile.subject,
      email: profile.email,
      encryptedRefreshToken,
      encryptedRefreshTokenDek,
      refreshTokenExpiresAt,
    });
  }

  private async lookupState(state: string): Promise<StoredAuthorizationState | undefined> {
    const raw = await this.cache.get(this.getStateKey(state));
    return raw ? (JSON.parse(raw) as StoredAuthorizationState) : undefined;
  }

  private async lookupPendingAuthorization(authorizationId: string): Promise<StoredPendingAuthorization | undefined> {
    const raw = await this.cache.get(this.getAuthorizationKey(authorizationId));
    return raw ? (JSON.parse(raw) as StoredPendingAuthorization) : undefined;
  }

  private async cachePendingAuthorization(args: Omit<StoredPendingAuthorization, 'authorizationId' | 'expiresAt'>): Promise<string> {
    const authorizationId = crypto.randomBytes(32).toString('base64url');
    const expiresAt = DateTime.utc().plus(this.options.pendingAuthorizationExpiration).toUnixInteger();
    const stored: StoredPendingAuthorization = { ...args, authorizationId, expiresAt };
    await this.cache.set(this.getAuthorizationKey(authorizationId), JSON.stringify(stored), this.options.pendingAuthorizationExpiration);
    return authorizationId;
  }

  /** Retrieve an OAuth 2.0 factor by id, scoped to the owning actor. */
  async getFactor(actorId: string, factorId: string) {
    return await this.repo.getFactor(actorId, factorId);
  }

  /** List OAuth 2.0 factors for an actor. Pass `active` to filter by activation state. */
  async listFactors(actorId: string, active?: boolean) {
    return await this.repo.listFactors(actorId, active);
  }

  /**
   * Look up a factor by its provider-side identity. Lookup is global, not per-actor —
   * `(provider, subject)` is unique system-wide. Returns `undefined` when no match exists.
   */
  async lookupFactor(provider: string, subject: string) {
    return await this.repo.lookupFactor({ provider, subject });
  }

  /** Permanently remove an OAuth 2.0 factor. */
  async deleteFactor(actorId: string, factorId: string) {
    await this.repo.deleteFactor(actorId, factorId);
  }
}
