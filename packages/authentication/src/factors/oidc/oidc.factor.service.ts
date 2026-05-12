import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import * as openidClient from 'openid-client';
import { CacheProvider } from '@maroonedsoftware/cache';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { PolicyService } from '@maroonedsoftware/policies';
import { OidcProviderRegistry } from '../../providers/oidc.provider.js';
import { AuthorizationCallbackParams } from '../authorization.callback.types.js';
import { OidcFactor, OidcFactorRepository } from './oidc.factor.repository.js';

/**
 * Normalized profile extracted from the IdP's id_token claims and `/userinfo`
 * response. Raw claims are preserved on `rawClaims` for app-specific extensions.
 */
export type OidcProfile = {
  /** Provider name that issued the profile (e.g. `"google"`). */
  provider: string;
  /** `sub` claim — stable per (provider, end-user). */
  subject: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  /** Union of id_token claims and /userinfo response. /userinfo overrides on conflict. */
  rawClaims: Record<string, unknown>;
};

/**
 * Result of a successful authorization callback.
 *
 * - `signed-in` — `(provider, subject)` already mapped to an actor; the session
 *   should be issued for `actorId`.
 * - `linked` — a factor was created during this call (either because `intent='link'`,
 *   or because the IdP returned a verified email that matched an existing actor).
 * - `new-user` — no existing actor was found. The caller should create an actor
 *   then call {@link OidcFactorService.createFactorFromAuthorization} with `authorizationId`.
 *   `emailConflict` is set when an actor with the same email exists but the email
 *   is unverified at the IdP — the UI should require the user to sign in to that
 *   account before linking the new provider.
 */
export type OidcAuthorizationResult =
  | {
      kind: 'signed-in';
      actorId: string;
      factorId: string;
      profile: OidcProfile;
      redirectAfter?: string;
    }
  | {
      kind: 'linked';
      actorId: string;
      factorId: string;
      profile: OidcProfile;
      redirectAfter?: string;
    }
  | {
      kind: 'new-user';
      authorizationId: string;
      profile: OidcProfile;
      emailConflict?: { actorId: string; reason: 'unverified-email' };
      redirectAfter?: string;
    };

type StoredAuthorizationState = {
  provider: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  intent: 'sign-in' | 'link';
  actorId?: string;
  redirectAfter?: string;
  issuedAt: number;
  expiresAt: number;
};

type StoredPendingAuthorization = {
  authorizationId: string;
  provider: string;
  profile: OidcProfile;
  refreshToken?: string;
  refreshTokenExpiresAt?: number | null;
  redirectAfter?: string;
  expiresAt: number;
};

/**
 * Implemented by the consuming app to bridge OIDC sign-in to whatever
 * primary-account lookup the app uses (e.g. an email factor table).
 *
 * Used by {@link OidcFactorService} to auto-link a fresh OIDC factor to an
 * existing actor when the IdP returns a verified email that matches an account.
 *
 * Return `undefined` for ambiguity — the service treats a missing actor as
 * "no auto-link", forcing the caller through the explicit new-user / link flow.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface OidcActorEmailLookup {
  findActorByEmail(email: string): Promise<string | undefined>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class OidcActorEmailLookup implements OidcActorEmailLookup {}

/**
 * Configuration options for {@link OidcFactorService}.
 */
@Injectable()
export class OidcFactorServiceOptions {
  constructor(
    /** How long a state record (the round-trip between authorize and callback) lives. */
    public readonly stateExpiration: Duration = Duration.fromDurationLike({ minutes: 10 }),
    /** How long a pending `new-user` authorization survives before the caller must complete it. */
    public readonly pendingAuthorizationExpiration: Duration = Duration.fromDurationLike({ minutes: 30 }),
  ) {}
}

/**
 * Orchestrates OIDC sign-in and account linking flows.
 *
 * Two-step flow that mirrors {@link EmailFactorService}:
 *
 * **Sign in** (the typical flow):
 * 1. Call {@link beginAuthorization} with `intent: 'sign-in'` → redirect the browser to `url`.
 * 2. On the callback route, parse the standard authorization-response payload
 *    (`code`, `state`, optionally `error`/`iss`) and call
 *    {@link completeAuthorization} with `{ params }`.
 *    - `kind: 'signed-in'` — issue a session for `actorId`.
 *    - `kind: 'linked'` — the factor was just auto-linked; issue a session for `actorId`.
 *    - `kind: 'new-user'` — show a sign-up screen, then call {@link createFactorFromAuthorization}.
 *
 * **Link an additional provider** to an already-signed-in actor:
 * 1. Call {@link beginAuthorization} with `intent: 'link'` and the current `actorId`.
 * 2. On the callback, call {@link completeAuthorization} → `kind: 'linked'`.
 */
@Injectable()
export class OidcFactorService {
  constructor(
    private readonly options: OidcFactorServiceOptions,
    private readonly registry: OidcProviderRegistry,
    private readonly repo: OidcFactorRepository,
    private readonly emailLookup: OidcActorEmailLookup,
    private readonly cache: CacheProvider,
    private readonly encryption: EncryptionProvider,
    private readonly logger: Logger,
    private readonly policyService: PolicyService,
  ) {}

  private getStateKey(state: string) {
    return `oidc_state_${state}`;
  }

  private getAuthorizationKey(authorizationId: string) {
    return `oidc_authorization_${authorizationId}`;
  }

  /**
   * Build the IdP authorize URL and cache the state record for the round-trip.
   *
   * @throws HTTP 404 when `provider` is not registered.
   * @throws HTTP 400 when `intent === 'link'` is requested without `actorId`.
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
    const oidcConfig = await this.registry.getConfiguration(args.provider);

    const state = openidClient.randomState();
    const nonce = openidClient.randomNonce();
    const codeVerifier = openidClient.randomPKCECodeVerifier();
    const codeChallenge = await openidClient.calculatePKCECodeChallenge(codeVerifier);

    const scopes = config.scopes.length > 0 ? config.scopes : ['openid', 'profile', 'email'];

    const url = openidClient.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: config.redirectUri.toString(),
      scope: scopes.join(' '),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...(config.authorizeParams ?? {}),
    });

    const issuedAt = DateTime.utc();
    const expiresAt = issuedAt.plus(this.options.stateExpiration);

    const stored: StoredAuthorizationState = {
      provider: args.provider,
      state,
      nonce,
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
   * Exchange the authorization code, validate the id_token, fetch userinfo, and
   * resolve to a factor (or a pending-authorization handle for new users).
   *
   * `params` is the standardized OIDC authorization-response payload
   * (RFC 6749 §4.1.2 + RFC 9207 `iss`). Callers parse it from the callback
   * `query`, form body (`response_mode=form_post`), or fragment — e.g.
   * `Object.fromEntries(ctx.query)` — and pass it through.
   *
   * The id_token is fully validated by openid-client: signature against the
   * provider's JWKS, `iss`, `aud`, `exp`, and the `nonce` we cached in
   * {@link beginAuthorization}. PKCE `code_verifier` is also bound to the
   * request. When `params.iss` is set, it is asserted against the discovered
   * issuer per RFC 9207 to close the mix-up attack.
   *
   * @throws HTTP 400 when the IdP returned an `error`, `state` is missing,
   *   `id_token` claims are missing, or the supplied `iss` does not match.
   * @throws HTTP 403 when the registered `'auth.factor.oidc.profile.allowed'` policy denies the profile.
   * @throws HTTP 404 when the state record has expired or does not exist.
   */
  async completeAuthorization(args: { params: AuthorizationCallbackParams }): Promise<OidcAuthorizationResult> {
    const { params } = args;

    if (params.error) {
      throw httpError(400)
        .withDetails({
          error: params.error,
          ...(params.error_description ? { error_description: params.error_description } : {}),
          ...(params.error_uri ? { error_uri: params.error_uri } : {}),
        });
    }

    if (!params.state) {
      throw httpError(400).withDetails({ state: 'missing from callback' });
    }

    const stored = await this.lookupState(params.state);
    if (!stored) {
      throw httpError(404).withDetails({ state: 'not found or expired' });
    }
    await this.cache.delete(this.getStateKey(params.state));

    const oidcConfig = await this.registry.getConfiguration(stored.provider);
    const providerConfig = this.registry.getConfig(stored.provider);

    if (params.iss !== undefined) {
      const expectedIssuer = oidcConfig.serverMetadata().issuer;
      if (params.iss !== expectedIssuer) {
        throw httpError(400).withDetails({ iss: 'does not match configured issuer' });
      }
    }

    const callbackUrl = new URL(providerConfig.redirectUri.toString());
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) callbackUrl.searchParams.set(key, value);
    }

    const tokens = await openidClient.authorizationCodeGrant(oidcConfig, callbackUrl, {
      expectedState: stored.state,
      expectedNonce: stored.nonce,
      pkceCodeVerifier: stored.codeVerifier,
    });

    const idTokenClaims = tokens.claims();
    if (!idTokenClaims) {
      throw httpError(400).withDetails({ id_token: 'missing claims' });
    }
    const subject = idTokenClaims.sub;

    let userinfo: openidClient.UserInfoResponse | undefined;
    try {
      userinfo = await openidClient.fetchUserInfo(oidcConfig, tokens.access_token, subject);
    } catch (error) {
      this.logger.warn('OIDC userinfo fetch failed; continuing with id_token claims only', {
        provider: stored.provider,
        error,
      });
    }

    const profile = this.buildProfile(stored.provider, idTokenClaims, userinfo);

    const policyResult = await this.policyService.check('auth.factor.oidc.profile.allowed', { profile });
    if (!policyResult.allowed) {
      throw httpError(403)
        .withDetails({ profile: 'not allowed' })
        .withInternalDetails({ reason: policyResult.reason, details: policyResult.details });
    }

    const refreshToken = providerConfig.persistRefreshToken && !this.registry.isPublicClient(stored.provider) ? tokens.refresh_token : undefined;
    const refreshTokenExpiresAt = this.computeRefreshTokenExpiry(tokens);

    // 1. Existing factor for (provider, subject) → signed-in
    const existing = await this.repo.findFactor({ provider: stored.provider, subject });
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

    // 2. Explicit link to a known actor → create the factor on that actor
    if (stored.intent === 'link') {
      const factor = await this.createFactor(stored.actorId!, profile, refreshToken, refreshTokenExpiresAt);
      return { kind: 'linked', actorId: factor.actorId, factorId: factor.id, profile, redirectAfter: stored.redirectAfter };
    }

    // 3. Sign-in with a new (provider, subject). Try to auto-link by verified email.
    if (profile.email && profile.emailVerified === true) {
      const matchedActorId = await this.emailLookup.findActorByEmail(profile.email);
      if (matchedActorId) {
        const factor = await this.createFactor(matchedActorId, profile, refreshToken, refreshTokenExpiresAt);
        return { kind: 'linked', actorId: factor.actorId, factorId: factor.id, profile, redirectAfter: stored.redirectAfter };
      }
    }

    // 4. Email matches an existing actor but is unverified at the IdP — surface the conflict.
    let emailConflict: { actorId: string; reason: 'unverified-email' } | undefined;
    if (profile.email && profile.emailVerified !== true) {
      const matchedActorId = await this.emailLookup.findActorByEmail(profile.email);
      if (matchedActorId) {
        emailConflict = { actorId: matchedActorId, reason: 'unverified-email' };
      }
    }

    // 5. Genuine new user — cache the verified profile + refresh token for the caller.
    const authorizationId = await this.cachePendingAuthorization({
      provider: stored.provider,
      profile,
      refreshToken,
      refreshTokenExpiresAt:
        refreshTokenExpiresAt instanceof Date ? Math.floor(refreshTokenExpiresAt.getTime() / 1000) : (refreshTokenExpiresAt ?? null),
      redirectAfter: stored.redirectAfter,
    });

    return { kind: 'new-user', authorizationId, profile, emailConflict, redirectAfter: stored.redirectAfter };
  }

  /**
   * Complete the `new-user` branch by attaching the cached profile to a freshly
   * created actor.
   *
   * @throws HTTP 404 when `authorizationId` has expired or does not exist.
   */
  async createFactorFromAuthorization(actorId: string, authorizationId: string): Promise<OidcFactor> {
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
   * Refresh the access token for a stored factor. Requires the provider to have
   * `persistRefreshToken: true` and a refresh token to have been captured during
   * a prior consent (e.g. Google requires `access_type=offline` + `prompt=consent`).
   *
   * If the IdP rotates refresh tokens, the new one is re-encrypted and persisted.
   *
   * @throws HTTP 404 when the factor has no persisted refresh token.
   */
  async refreshAccessToken(
    actorId: string,
    factorId: string,
  ): Promise<{
    accessToken: string;
    expiresAt: DateTime | null;
    scope?: string;
    idToken?: string;
  }> {
    const factor = await this.repo.getFactor(actorId, factorId);
    if (!factor.encryptedRefreshToken || !factor.encryptedRefreshTokenDek) {
      throw httpError(404).withDetails({ refreshToken: 'no refresh token persisted for factor' });
    }

    const refreshToken = this.encryption.decryptWithDek(factor.encryptedRefreshToken, factor.encryptedRefreshTokenDek);
    const oidcConfig = await this.registry.getConfiguration(factor.provider);
    const tokens = await openidClient.refreshTokenGrant(oidcConfig, refreshToken);

    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      const { encryptedValue, encryptedDek } = this.encryption.encryptWithNewDek(tokens.refresh_token);
      await this.repo.updateRefreshToken(factor.id, {
        encryptedRefreshToken: encryptedValue,
        encryptedRefreshTokenDek: encryptedDek,
        refreshTokenExpiresAt: this.computeRefreshTokenExpiry(tokens),
      });
    }

    const expiresAt = tokens.expires_in !== undefined ? DateTime.utc().plus({ seconds: tokens.expires_in }) : null;

    return {
      accessToken: tokens.access_token,
      expiresAt,
      scope: tokens.scope,
      idToken: tokens.id_token,
    };
  }

  /**
   * `true` when the pending authorization is still cached and unconsumed.
   */
  async hasPendingAuthorization(authorizationId: string): Promise<boolean> {
    return (await this.lookupPendingAuthorization(authorizationId)) !== undefined;
  }

  private async createFactor(
    actorId: string,
    profile: OidcProfile,
    refreshToken: string | undefined,
    refreshTokenExpiresAt: Date | null | undefined,
  ): Promise<OidcFactor> {
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

  private buildProfile(provider: string, idTokenClaims: openidClient.IDToken, userinfo: openidClient.UserInfoResponse | undefined): OidcProfile {
    const merged: Record<string, unknown> = { ...idTokenClaims, ...(userinfo ?? {}) };
    const subject = (userinfo?.sub ?? idTokenClaims.sub) as string;
    const email = (merged.email as string | undefined) ?? undefined;
    const emailVerified = typeof merged.email_verified === 'boolean' ? merged.email_verified : undefined;
    const name = (merged.name as string | undefined) ?? undefined;
    const picture = (merged.picture as string | undefined) ?? undefined;
    return { provider, subject, email, emailVerified, name, picture, rawClaims: merged };
  }

  private computeRefreshTokenExpiry(tokens: openidClient.TokenEndpointResponse): Date | null | undefined {
    const expiresIn = (tokens as unknown as { refresh_token_expires_in?: number }).refresh_token_expires_in;
    if (typeof expiresIn === 'number') {
      return new Date(Date.now() + expiresIn * 1000);
    }
    return null;
  }

  /** Retrieve an OIDC factor by id, scoped to the owning actor. */
  async getFactor(actorId: string, factorId: string) {
    return await this.repo.getFactor(actorId, factorId);
  }

  /** List OIDC factors for an actor. Pass `active` to filter by activation state. */
  async listFactors(actorId: string, active?: boolean) {
    return await this.repo.listFactors(actorId, active);
  }

  /**
   * Find a factor by its provider-side identity. Lookup is global, not per-actor —
   * `(provider, subject)` is unique system-wide. Returns `undefined` when no match exists.
   */
  async findFactor(provider: string, subject: string) {
    return await this.repo.findFactor({ provider, subject });
  }

  /** Permanently remove an OIDC factor. */
  async deleteFactor(actorId: string, factorId: string) {
    await this.repo.deleteFactor(actorId, factorId);
  }
}
