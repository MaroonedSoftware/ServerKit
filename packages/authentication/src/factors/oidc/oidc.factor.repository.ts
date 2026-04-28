import { Injectable } from 'injectkit';

/**
 * A persisted OpenID Connect authentication factor.
 *
 * Identity is `(provider, subject)` — `subject` is the IdP's `sub` claim, which is
 * stable per-user-per-provider. `email` is denormalized for the auto-link-by-email
 * flow; it's the email last seen during sign-in and should not be relied on for
 * authentication on its own.
 *
 * Refresh tokens are envelope-encrypted via {@link @maroonedsoftware/encryption}.
 * Persisted only when the provider config has `persistRefreshToken: true`.
 */
export type OidcFactor = {
  /** Unique identifier for this factor record. */
  id: string;
  /** The actor this factor belongs to. */
  actorId: string;
  /** Whether this factor is currently active and may be used for authentication. */
  active: boolean;
  /** Provider name as registered in {@link OidcProviderRegistry} (e.g. `"google"`). */
  provider: string;
  /** `sub` claim from the id_token — stable per (provider, end-user). */
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
 * Repository interface for persisting OIDC authentication factors.
 *
 * Implementations should enforce uniqueness on `(provider, subject)` so the same
 * IdP account cannot be linked to two different actors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface OidcFactorRepository {
  /** Persist a new OIDC factor for an actor. */
  createFactor(args: {
    actorId: string;
    provider: string;
    subject: string;
    email?: string;
    encryptedRefreshToken?: string;
    encryptedRefreshTokenDek?: string;
    refreshTokenExpiresAt?: Date | null;
  }): Promise<OidcFactor>;

  /** Look up a factor by its provider-side identity — `null`/`undefined` when not linked. */
  lookupFactor(provider: string, subject: string): Promise<OidcFactor | undefined>;

  /**
   * Look up every OIDC factor whose last-seen email matches `email`.
   *
   * Used by the auto-link flow to find an actor when the IdP returns a verified
   * email that matches another factor on the system.
   */
  lookupFactorsByEmail(email: string): Promise<OidcFactor[]>;

  /** Retrieve a specific factor by id, scoped to the owning actor. */
  getFactor(actorId: string, factorId: string): Promise<OidcFactor>;

  /** List active OIDC factors for an actor. Used to render account-settings UI. */
  listFactorsForActor(actorId: string): Promise<OidcFactor[]>;

  /**
   * Update the persisted refresh token for an existing factor (e.g. after rotation
   * during a token grant). Pass `null` for `refreshTokenExpiresAt` to mean "no expiry".
   */
  updateRefreshToken(
    factorId: string,
    args: { encryptedRefreshToken: string; encryptedRefreshTokenDek: string; refreshTokenExpiresAt?: Date | null },
  ): Promise<void>;

  /** Update the last-seen email on an existing factor. */
  updateEmail(factorId: string, email: string): Promise<void>;

  /** Permanently remove a factor. */
  deleteFactor(actorId: string, factorId: string): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class OidcFactorRepository implements OidcFactorRepository {}
