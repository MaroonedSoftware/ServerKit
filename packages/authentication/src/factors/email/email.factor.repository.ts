import { Injectable } from 'injectkit';

/**
 * A persisted email authentication factor record.
 */
export type EmailFactor = {
  /** Unique identifier for this factor record. */
  id: string;
  /** The actor this factor belongs to. */
  actorId: string;
  /** Whether this factor is currently active and may be used for authentication. */
  active: boolean;
  /** The email address associated with this factor. */
  value: string;
};

/**
 * Repository interface for persisting email authentication factors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface EmailFactorRepository {
  /**
   * Persist a new email factor for an actor.
   * @param actorId            - The actor to associate the factor with.
   * @param value              - The verified email address.
   * @returns The newly created {@link EmailFactor}.
   */
  createFactor(actorId: string, value: string): Promise<EmailFactor>;

  /**
   * Check whether an email address already has a factor registered.
   * @param value - The email address to look up.
   * @returns `true` if an existing factor was found, `false` otherwise.
   */
  doesEmailExist(value: string): Promise<boolean>;

  /**
   * Check whether a domain is invite-only.
   * @param domain - The domain to look up.
   * @returns `true` if the domain is invite-only, `false` otherwise.
   */
  isDomainInviteOnly(domain: string): Promise<boolean>;

  /**
   * Retrieve a specific email factor for an actor.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id.
   * @returns The matching {@link EmailFactor}.
   */
  getFactor(actorId: string, factorId: string): Promise<EmailFactor>;

  /**
   * Remove an email factor.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id to delete.
   */
  deleteFactor(actorId: string, factorId: string): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class EmailFactorRepository implements EmailFactorRepository {}
