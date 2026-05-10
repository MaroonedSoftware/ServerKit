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
export interface EmailFactorRepository extends Omit<FactorRepository<EmailFactor>, 'lookupFactor'> {
  /**
   * Look up an email factor by email address.
   * @param value - The email address to look up.
   * @returns The matching {@link EmailFactor}, or `undefined` if not found.
   */
  lookupFactor(value: string): Promise<EmailFactor | undefined>;
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
