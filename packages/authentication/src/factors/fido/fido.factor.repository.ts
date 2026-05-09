import { Injectable } from 'injectkit';

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
export type FidoFactor = FidoFactorOptions & {
  /** Unique identifier for this factor record. */
  id: string;
  /** The actor this factor belongs to. */
  actorId: string;
  /** Whether this factor is currently active and may be used for authentication. */
  active: boolean;
};

/**
 * Repository interface for persisting FIDO/WebAuthn authentication factors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface FidoFactorRepository {
  /**
   * Persist a new FIDO factor for an actor.
   *
   * Implementations should default the new factor to active. The returned
   * {@link FidoFactor} carries the assigned row `id` along with the supplied
   * options.
   *
   * @param actorId - The actor to associate the factor with.
   * @param options - Public key material and optional metadata extracted from
   *   the verified attestation.
   * @returns The newly created {@link FidoFactor}.
   */
  createFactor(actorId: string, options: FidoFactorOptions): Promise<FidoFactor>;

  /**
   * List an actor's FIDO factors, filtered by active status.
   *
   * Used during the authorization challenge to populate `allowCredentials` so
   * the browser only prompts the user for credentials they actually have.
   *
   * @param actorId - The actor whose factors to list.
   * @param active  - When `true`, return only active factors.
   */
  listFactors(actorId: string, active: boolean): Promise<FidoFactor[]>;

  /**
   * Retrieve a specific FIDO factor for an actor.
   *
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id.
   * @returns The matching {@link FidoFactor}, or `undefined` if not found.
   */
  getFactor(actorId: string, factorId: string): Promise<FidoFactor | undefined>;

  /**
   * Look up a factor by its credential id.
   * @param actorId  - The actor that owns the factor.
   * @param credentialId - The credential id reported by the authenticator (the
   * `id` field of the `PublicKeyCredential` returned by the browser).
   * @returns The matching {@link FidoFactor}, or `undefined` if not found.
   */
  lookupFactor(actorId: string, credentialId: string): Promise<FidoFactor | undefined>;

  /**
   * Persist the latest signature counter after a successful assertion.
   *
   * The new counter must always be strictly greater than the stored value —
   * counter regressions indicate a cloned authenticator and should be treated
   * as a security event.
   *
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id.
   * @param counter  - The new counter value reported by the authenticator.
   */
  updateFactorCounter(actorId: string, factorId: string, counter: number): Promise<void>;

  /**
   * Remove a FIDO factor.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id to delete.
   */
  deleteFactor(actorId: string, factorId: string): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class FidoFactorRepository implements FidoFactorRepository {}
