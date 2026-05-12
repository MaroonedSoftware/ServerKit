import { Injectable } from 'injectkit';
import { Factor, FactorRepository } from '../factor.repository.js';

/** A hashed recovery code value, encoded so it round-trips safely through storage. */
export type RecoveryCodeValue = {
  /** Encoded recovery code hash. */
  hash: string;
  /** Encoded salt used to derive the hash. May be empty for self-describing hashes (e.g. Argon2id PHC). */
  salt: string;
};

/**
 * A persisted recovery code authentication factor. Recovery codes are
 * pre-generated, single-use backup credentials issued in batches; each code is
 * stored as its own factor row so individual codes can be consumed independently.
 */
export type RecoveryCodeFactor = Factor & {
  /** The hashed code material. */
  value: RecoveryCodeValue;
  /** Groups codes generated together; every code from a single `generate` call shares one `batchId`. */
  batchId: string;
  /** Unix timestamp (seconds) when this code was consumed; absent until first use. */
  usedAt?: number;
};

/**
 * Repository interface for persisting recovery code factors.
 *
 * Implementations should ensure {@link replaceAll} is atomic: any prior batch
 * must be invalidated (deleted or soft-archived) before the new batch becomes
 * visible, so a verifier observing the new batch never simultaneously accepts
 * a code from the old batch.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface RecoveryCodeFactorRepository extends FactorRepository<RecoveryCodeFactor, RecoveryCodeValue, RecoveryCodeValue> {
  /** Mark a code as consumed. Implementations typically also set `active = false`. */
  markUsed(actorId: string, factorId: string): Promise<RecoveryCodeFactor>;
  /** Replace every recovery code on file for `actorId` with the supplied batch. Atomic. */
  replaceAll(actorId: string, values: ReadonlyArray<{ value: RecoveryCodeValue; batchId: string }>): Promise<RecoveryCodeFactor[]>;
  /** Count active (unused) recovery codes on file for `actorId`. */
  countActive(actorId: string): Promise<number>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class RecoveryCodeFactorRepository implements RecoveryCodeFactorRepository {}
