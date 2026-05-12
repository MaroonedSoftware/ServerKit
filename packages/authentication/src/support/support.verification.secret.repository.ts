import { Injectable } from 'injectkit';
import { OtpOptions } from '../providers/otp.provider.js';

/**
 * Persisted per-actor secret backing the rotating support-verification code.
 *
 * The {@link secretHash} is the OTP secret encrypted at rest with the
 * application's {@link import('@maroonedsoftware/encryption').EncryptionProvider};
 * it is never stored as plaintext.
 */
export interface SupportVerificationSecret {
  /** The actor this secret belongs to. */
  actorId: string;
  /** The OTP secret encrypted with the application master key. */
  secretHash: string;
  /** OTP algorithm/format options the secret was generated for. */
  options: OtpOptions;
  /** Unix timestamp (seconds) when this secret was created. */
  createdAt: number;
}

/**
 * Repository interface for persisting per-actor support-verification secrets.
 *
 * Each actor has at most one active secret; {@link upsertSecret} replaces any
 * prior secret atomically so a rotation invalidates older codes immediately.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface SupportVerificationSecretRepository {
  /** Retrieve the secret on file for an actor, or `undefined` when none has been issued. */
  getSecret(actorId: string): Promise<SupportVerificationSecret | undefined>;
  /** Insert or replace the actor's secret. Atomic — replaces any prior secret. */
  upsertSecret(actorId: string, value: { secretHash: string; options: OtpOptions }): Promise<SupportVerificationSecret>;
  /** Permanently remove the actor's secret. No-op when no secret is on file. */
  deleteSecret(actorId: string): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class SupportVerificationSecretRepository implements SupportVerificationSecretRepository {}
