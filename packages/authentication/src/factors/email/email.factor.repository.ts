import { Injectable } from 'injectkit';
import { Factor, FactorRepository } from '../factor.repository.js';

/**
 * A persisted email authentication factor record.
 */
export type EmailFactor = Factor & {
  /** The email address associated with this factor. */
  value: string;
};

/**
 * Repository interface for persisting email authentication factors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface EmailFactorRepository extends FactorRepository<EmailFactor> {
  /**
   * Find an email factor globally by email address. Email addresses are
   * unique system-wide, so this is the lookup used by registration to detect
   * existing accounts and by sign-in to resolve a callback to an actor.
   *
   * @param value - The email address to look up.
   * @returns The matching {@link EmailFactor}, or `undefined` if not found.
   */
  findFactor(value: string): Promise<EmailFactor | undefined>;
  /**
   * Check whether a domain is invite-only.
   * @param domain - The domain to look up.
   * @returns `true` if the domain is invite-only, `false` otherwise.
   */
  isDomainInviteOnly(domain: string): Promise<boolean>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class EmailFactorRepository implements EmailFactorRepository {}
