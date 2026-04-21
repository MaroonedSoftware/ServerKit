import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';

/**
 * A persisted email authentication factor record.
 */
export type EmailFactor = {
  /** Unique identifier for this factor record. */
  id: string;
  /** The actor (user) this factor belongs to. */
  actorId: string;
  /** Whether this factor is currently active and may be used for authentication. */
  active: boolean;
  /** The email address associated with this factor. */
  value: string;
  /** When the email address was verified, or `undefined` if not yet verified. */
  verifiedAt: DateTime | undefined;
};

/**
 * Abstract repository for persisting email authentication factors.
 *
 * Extend this class and register your concrete implementation (e.g. using a
 * PostgreSQL table) in the DI container so that {@link EmailFactorService} can
 * resolve it at runtime.
 */
@Injectable()
export abstract class EmailFactorRepository {
  /**
   * Persist a new email factor for an actor.
   * @param actorId            - The actor to associate the factor with.
   * @param value              - The verified email address.
   * @param verificationMethod - The method used to verify the address (`"code"` or `"magiclink"`).
   * @returns The newly created {@link EmailFactor}.
   */
  abstract createFactor(actorId: string, value: string, verificationMethod?: string): Promise<EmailFactor>;

  /**
   * Check whether an email address already has a factor registered.
   * @param value - The email address to look up.
   * @returns `true` if an existing factor was found, `false` otherwise.
   */
  abstract doesEmailExist(value: string): Promise<boolean>;

  /**
   * Retrieve a specific email factor for an actor.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id.
   * @returns The matching {@link EmailFactor}.
   */
  abstract getFactor(actorId: string, factorId: string): Promise<EmailFactor>;

  /**
   * Remove an email factor.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id to delete.
   */
  abstract deleteFactor(actorId: string, factorId: string): Promise<void>;
}
