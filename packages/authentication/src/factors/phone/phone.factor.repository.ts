import { Injectable } from 'injectkit';
import { Factor, FactorRepository } from '../factor.repository.js';

/**
 * A persisted phone number factor record.
 */
export type PhoneFactor = Factor & {
  /** The E.164-formatted phone number associated with this factor. */
  value: string;
};

/**
 * Repository interface for persisting phone number factors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface PhoneFactorRepository extends FactorRepository<PhoneFactor> {}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class PhoneFactorRepository implements PhoneFactorRepository {}
