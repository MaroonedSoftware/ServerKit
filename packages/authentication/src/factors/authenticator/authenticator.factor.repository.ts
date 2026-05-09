import { Injectable } from 'injectkit';
import { OtpOptions } from '../../providers/otp.provider.js';

/**
 * OTP configuration and encrypted secret stored alongside an authenticator factor.
 * Extends {@link OtpOptions} with the encrypted secret so the factor record is
 * self-contained — the secret never needs to be stored in plaintext.
 */
export type AuthenticatorFactorOptions = OtpOptions & {
  /** The OTP secret encrypted with the application master key. */
  secretHash: string;
  /** A human-readable label for the factor (e.g. "Personal phone"). */
  label?: string;
};

/**
 * A persisted TOTP/HOTP authenticator factor record.
 */
export type AuthenticatorFactor = Required<Omit<AuthenticatorFactorOptions, 'label'>> & {
  /** Unique identifier for this factor record. */
  id: string;
  /** The actor this factor belongs to. */
  actorId: string;
  /** Whether this factor is currently active and may be used for authentication. */
  active: boolean;
  /** A human-readable label for the factor. */
  label?: string;
};

/**
 * Repository interface for persisting authenticator (TOTP/HOTP) factors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface AuthenticatorFactorRepository {
  /**
   * Persist a new authenticator factor for an actor.
   * @param actorId - The actor to associate the factor with.
   * @param options - OTP configuration and encrypted secret for the factor.
   * @returns The newly created {@link AuthenticatorFactor}.
   */
  createFactor(actorId: string, options: AuthenticatorFactorOptions): Promise<AuthenticatorFactor>;

  /**
   * Retrieve a specific authenticator factor for an actor.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id.
   * @returns The matching {@link AuthenticatorFactor}, or `undefined` if not found.
   */
  getFactor(actorId: string, factorId: string): Promise<AuthenticatorFactor | undefined>;

  /**
   * Remove an authenticator factor.
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id to delete.
   */
  deleteFactor(actorId: string, factorId: string): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class AuthenticatorFactorRepository implements AuthenticatorFactorRepository {}
