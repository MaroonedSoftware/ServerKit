import { Injectable } from 'injectkit';
import type { Factor, FactorRepository } from '@maroonedsoftware/authentication';

/**
 * Provider-side identity used to look up a SAML factor.
 */
export type SamlFactorLookup = {
  /** Provider name as listed by the {@link SamlProviderSource} (e.g. `"acme.okta"`). */
  provider: string;
  /** The assertion's `NameID`, stable per (provider, end-user) for a persistent or email format. */
  subject: string;
};

/**
 * Material persisted alongside a {@link SamlFactor} when the factor is created.
 */
export type SamlFactorValue = {
  /** Provider name as listed by the {@link SamlProviderSource} (e.g. `"acme.okta"`). */
  provider: string;
  /** The assertion's `NameID`. */
  subject: string;
  /** Last-seen email for this factor. Optional: not every IdP sends one. */
  email?: string;
};

/**
 * A persisted SAML 2.0 authentication factor.
 *
 * Identity is `(provider, subject)`, where `subject` is the IdP's `NameID`. `email` is
 * denormalized for the auto-link-by-email flow; it is the email last seen during sign-in and
 * should not be relied on for authentication on its own.
 */
export type SamlFactor = Factor & SamlFactorValue;

/**
 * Repository interface for persisting SAML authentication factors.
 *
 * Implementations should enforce uniqueness on `(provider, subject)` so the same IdP account
 * cannot be linked to two different actors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface SamlFactorRepository extends FactorRepository<SamlFactor, SamlFactorValue, SamlFactorLookup> {
  /**
   * Find a factor globally by its provider-side identity. `(provider, subject)` is unique
   * system-wide, so this is the lookup that resolves an assertion to an existing actor.
   * Returns `undefined` when no factor matches.
   */
  findFactor(value: SamlFactorLookup): Promise<SamlFactor | undefined>;

  /** Update the last-seen email on an existing factor. */
  updateEmail(factorId: string, email: string): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class SamlFactorRepository implements SamlFactorRepository {}
