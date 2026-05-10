import { Injectable } from 'injectkit';
import { Factor, FactorRepository } from '../factor.repository.js';

/**
 * Provider-side identity used to look up an OAuth 2.0 factor.
 */
export type OAuth2FactorLookup = {
  /** Provider name as registered in {@link OAuth2ProviderRegistry} (e.g. `"github"`). */
  provider: string;
  /** Provider-specific user id, coerced to a string. */
  subject: string;
};

/**
 * Material persisted alongside an {@link OAuth2Factor} when the factor is created.
 */
export type OAuth2FactorValue = {
  /** Provider name as registered in {@link OAuth2ProviderRegistry} (e.g. `"github"`). */
  provider: string;
  /** Provider-specific user id (GitHub's numeric id, Discord's snowflake, etc), coerced to a string. */
  subject: string;
  /** Last-seen email for this factor. Optional — not all providers return one. */
  email?: string;
  /** Envelope-encrypted refresh token; present only when the provider persists refresh tokens. */
  encryptedRefreshToken?: string;
  /** Encrypted DEK for the refresh token. Present iff `encryptedRefreshToken` is. */
  encryptedRefreshTokenDek?: string;
  /** When the persisted refresh token expires. `null`/`undefined` for non-expiring refresh tokens. */
  refreshTokenExpiresAt?: Date | null;
};

/**
 * A persisted OAuth 2.0 (non-OIDC) authentication factor.
 *
 * Identity is `(provider, subject)`. `subject` is the provider-specific user id
 * coerced to a string — GitHub's numeric id, Discord's snowflake, etc.
 *
 * Stored in a separate table from {@link OidcFactor} because the trust model
 * differs: OAuth 2.0 profiles come from the userinfo endpoint, not a signed
 * id_token, and `emailVerified` semantics vary by provider.
 */
export type OAuth2Factor = Factor & OAuth2FactorValue;

/**
 * Repository interface for persisting OAuth 2.0 authentication factors.
 *
 * Implementations should enforce uniqueness on `(provider, subject)` so the same
 * provider account cannot be linked to two different actors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface OAuth2FactorRepository extends Omit<FactorRepository<OAuth2Factor, OAuth2FactorValue, OAuth2FactorLookup>, 'lookupFactor'> {
  /**
   * Look up a factor by its provider-side identity.
   *
   * Unlike the base contract's per-actor `lookupFactor`, this is global —
   * `(provider, subject)` is unique system-wide, and the lookup is what resolves
   * a callback to an existing actor. Returns `undefined` when no factor matches.
   */
  lookupFactor(value: OAuth2FactorLookup): Promise<OAuth2Factor | undefined>;

  /** Look up factors by last-seen email — used by the auto-link flow when the provider returns a verified email. */
  lookupFactorsByEmail(email: string): Promise<OAuth2Factor[]>;

  /** Update the persisted refresh token for an existing factor (e.g. after rotation). Pass `null` for `refreshTokenExpiresAt` to mean "no expiry". */
  updateRefreshToken(
    factorId: string,
    args: { encryptedRefreshToken: string; encryptedRefreshTokenDek: string; refreshTokenExpiresAt?: Date | null },
  ): Promise<void>;

  /** Update the last-seen email on an existing factor. */
  updateEmail(factorId: string, email: string): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class OAuth2FactorRepository implements OAuth2FactorRepository {}
