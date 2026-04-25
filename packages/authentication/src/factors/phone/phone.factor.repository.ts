import { Injectable } from 'injectkit';

/**
 * A persisted phone number factor record.
 */
export interface PhoneFactor {
  /** Unique identifier for this factor record. */
  id: string;
  /** The actor this factor belongs to. */
  actorId: string;
  /** Whether this factor is currently active and may be used for authentication. */
  active: boolean;
  /** The E.164-formatted phone number associated with this factor. */
  value: string;
}

/**
 * Repository interface for persisting phone number factors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface PhoneFactorRepository {
  /**
   * Persist a new phone factor for an actor.
   * @param actorId - The actor to associate the factor with.
   * @param value   - The E.164-formatted phone number.
   * @returns The newly created {@link PhoneFactor}.
   */
  createFactor(actorId: string, value: string): Promise<PhoneFactor>;

  /**
   * Find an existing phone factor by actor and phone number.
   * @param actorId - The actor that owns the factor.
   * @param value   - The E.164-formatted phone number to look up.
   * @returns The matching {@link PhoneFactor}, or `undefined` if not found.
   */
  findFactor(actorId: string, value: string): Promise<PhoneFactor | undefined>;

  /**
   * Retrieve a specific phone factor by id.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id.
   * @returns The matching {@link PhoneFactor}, or `undefined` if not found.
   */
  getFactor(actorId: string, factorId: string): Promise<PhoneFactor | undefined>;

  /**
   * Remove a phone factor.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id to delete.
   */
  deleteFactor(actorId: string, factorId: string): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class PhoneFactorRepository implements PhoneFactorRepository {}
