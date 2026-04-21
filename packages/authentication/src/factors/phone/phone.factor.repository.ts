import { Injectable } from 'injectkit';

/**
 * A persisted phone number factor record.
 */
export interface PhoneFactor {
  /** Unique identifier for this factor record. */
  id: string;
  /** Whether this factor is currently active and may be used for authentication. */
  active: boolean;
  /** The E.164-formatted phone number associated with this factor. */
  value: string;
}

/**
 * Abstract repository for persisting phone number factors.
 *
 * Extend this class and register your concrete implementation (e.g. a PostgreSQL
 * table) in the DI container so that {@link PhoneFactorService} can resolve it
 * at runtime.
 */
@Injectable()
export abstract class PhoneFactorRepository {
  /**
   * Persist a new phone factor for an actor.
   * @param actorId - The actor to associate the factor with.
   * @param value   - The E.164-formatted phone number.
   * @returns The newly created {@link PhoneFactor}.
   */
  abstract createFactor(actorId: string, value: string): Promise<PhoneFactor>;

  /**
   * Find an existing phone factor by actor and phone number.
   * @param actorId - The actor that owns the factor.
   * @param value   - The E.164-formatted phone number to look up.
   * @returns The matching {@link PhoneFactor}, or `undefined` if not found.
   */
  abstract findFactor(actorId: string, value: string): Promise<PhoneFactor | undefined>;

  /**
   * Retrieve a specific phone factor by id.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id.
   * @returns The matching {@link PhoneFactor}, or `undefined` if not found.
   */
  abstract getFactor(actorId: string, factorId: string): Promise<PhoneFactor | undefined>;

  /**
   * Remove a phone factor.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id to delete.
   */
  abstract deleteFactor(actorId: string, factorId: string): Promise<void>;
}
