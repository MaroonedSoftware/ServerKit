import { Injectable } from 'injectkit';
import { OtpOptions } from '../../providers/otp.provider.js';
import { Factor, FactorRepository } from '../factor.repository.js';

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
export type AuthenticatorFactor = Factor & AuthenticatorFactorOptions;

/**
 * Repository interface for persisting authenticator (TOTP/HOTP) factors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface AuthenticatorFactorRepository extends FactorRepository<AuthenticatorFactor, AuthenticatorFactorOptions, string> {}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class AuthenticatorFactorRepository implements AuthenticatorFactorRepository {}
