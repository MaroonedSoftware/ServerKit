import { Injectable } from 'injectkit';

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
export type OAuth2Factor = {
  id: string;
  actorId: string;
  active: boolean;
  provider: string;
  subject: string;
  email?: string;
  encryptedRefreshToken?: string;
  encryptedRefreshTokenDek?: string;
  refreshTokenExpiresAt?: Date | null;
};

/**
 * Repository interface for persisting OAuth 2.0 authentication factors.
 *
 * Implementations should enforce uniqueness on `(provider, subject)` so the same
 * provider account cannot be linked to two different actors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface OAuth2FactorRepository {
  createFactor(args: {
    actorId: string;
    provider: string;
    subject: string;
    email?: string;
    encryptedRefreshToken?: string;
    encryptedRefreshTokenDek?: string;
    refreshTokenExpiresAt?: Date | null;
  }): Promise<OAuth2Factor>;

  lookupFactor(provider: string, subject: string): Promise<OAuth2Factor | undefined>;

  /** Look up factors by last-seen email — used by the auto-link flow when the provider returns a verified email. */
  lookupFactorsByEmail(email: string): Promise<OAuth2Factor[]>;

  getFactor(actorId: string, factorId: string): Promise<OAuth2Factor>;

  listFactorsForActor(actorId: string): Promise<OAuth2Factor[]>;

  updateRefreshToken(
    factorId: string,
    args: { encryptedRefreshToken: string; encryptedRefreshTokenDek: string; refreshTokenExpiresAt?: Date | null },
  ): Promise<void>;

  updateEmail(factorId: string, email: string): Promise<void>;

  deleteFactor(actorId: string, factorId: string): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class OAuth2FactorRepository implements OAuth2FactorRepository {}
