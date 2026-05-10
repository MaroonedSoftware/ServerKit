import { Injectable } from 'injectkit';
import { Factor, FactorRepository } from '../factor.repository.js';

/**
 * Material extracted from a verified WebAuthn attestation, plus optional
 * caller-supplied metadata, that is persisted as a new {@link FidoFactor}.
 */
export type FidoFactorOptions = {
  /** PEM-encoded public key extracted from the authenticator's attestation. */
  publicKey: string;
  /** The credential id (base64-encoded) returned by the authenticator at registration. Used to look up the factor on assertion. */
  publicKeyId: string;
  /** Signature counter from the most recent successful assertion. Used by `fido2-lib` to detect cloned authenticators. */
  counter: number;
  /** A human-readable label for the factor (e.g. "MacBook Touch ID"). */
  label?: string;
};

/**
 * A persisted FIDO/WebAuthn authentication factor record.
 */
export type FidoFactor = Factor & FidoFactorOptions;

/**
 * Repository interface for persisting FIDO/WebAuthn authentication factors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface FidoFactorRepository extends FactorRepository<FidoFactor, FidoFactorOptions, string> {
  /**
   * Look up a factor by its credential id.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id.
   * @param counter  - The new counter value reported by the authenticator.
   */
  updateFactorCounter(actorId: string, factorId: string, counter: number): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class FidoFactorRepository implements FidoFactorRepository {}
