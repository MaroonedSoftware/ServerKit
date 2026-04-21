import { Injectable } from 'injectkit';
import { toDataURL } from 'qrcode';
import { OtpOptions, OtpProvider } from '../../providers/otp.provider.js';
import { AuthenticatorFactorRepository } from './authenticator.factor.repository.js';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { DateTime, Duration } from 'luxon';
import { CacheProvider } from '../../providers/cache.provider.js';
import crypto from 'node:crypto';

/**
 * Configuration options for {@link AuthenticatorFactorService}.
 */
export type AuthenticatorFactorServiceOptions = {
  /** The issuer name embedded in provisioning URIs (shown in the authenticator app). */
  issuer: string;
  /**
   * How long a pending registration stays valid before it must be completed.
   * Defaults to 30 minutes.
   */
  registrationExpiration?: Duration;
  /**
   * How long a validated factor session remains cached.
   * Defaults to 4 hours.
   */
  factorExpiration?: Duration;
  /** Default OTP algorithm options applied when none are supplied per-call. */
  defaults?: OtpOptions;
};

const AuthenticatorFactorServiceOptionsDefaults = {
  registrationExpiration: Duration.fromDurationLike({ minutes: 30 }),
  factorExpiration: Duration.fromDurationLike({ hours: 4 }),
  defaults: {
    type: 'totp',
    algorithm: 'SHA1',
    counter: 0,
    periodSeconds: 30,
    tokenLength: 6,
  },
} as const;

type RegistrationPayload = {
  id: string;
  actorId: string;
  secretHash: string;
  expiresAt: number;
  issuedAt: number;
  otpOptions: OtpOptions;
};

/**
 * Manages the lifecycle of TOTP/HOTP authenticator app factors.
 *
 * **Registration flow:**
 * 1. Call {@link registerAuthenticatorFactor} — generates a secret, returns a QR code URI
 *    and a `registrationId`. Display the QR code to the user so they can scan it into
 *    their authenticator app.
 * 2. Call {@link createAuthenticatorFactorFromRegistration} with the code the user enters —
 *    verifies the code and persists the factor.
 *
 * **Verification flow:**
 * - Call {@link validateFactor} with the actor id, factor id, and the current TOTP code.
 *
 * The OTP secret is stored encrypted via {@link EncryptionProvider} and is never
 * persisted in plaintext.
 */
@Injectable()
export class AuthenticatorFactorService {
  private readonly options: Required<AuthenticatorFactorServiceOptions>;
  constructor(
    options: AuthenticatorFactorServiceOptions,
    private readonly otpProvider: OtpProvider,
    private readonly authenticatorFactorRepository: AuthenticatorFactorRepository,
    private readonly encryptionProvider: EncryptionProvider,
    private readonly cache: CacheProvider,
  ) {
    this.options = { ...AuthenticatorFactorServiceOptionsDefaults, ...options };
  }

  private getRegistrationKey(key: string) {
    return `authenticator_factor_registration_${key}`;
  }

  private async cacheRegistration(payload: RegistrationPayload, expiration: Duration) {
    const registrationId = crypto.randomBytes(32).toString('base64url');

    payload.id = registrationId;

    await this.cache.set(this.getRegistrationKey(registrationId), JSON.stringify(payload), expiration);

    return registrationId;
  }

  private async lookupRegistration(registrationId: string) {
    const response = await this.cache.get<string>(this.getRegistrationKey(registrationId));

    return response ? (JSON.parse(response) as RegistrationPayload) : undefined;
  }

  /**
   * Initiate authenticator factor registration by generating a TOTP secret, an
   * `otpauth://` provisioning URI, and a QR code data URL.
   *
   * Display the QR code to the user so they can scan it into their authenticator app,
   * then call {@link createAuthenticatorFactorFromRegistration} with the code they enter.
   *
   * @param actorId - The actor registering the factor.
   * @param options - OTP options to override the service defaults (algorithm, period, etc.).
   * @returns `{ registrationId, secret, uri, qrCode, expiresAt }` — the registration
   *   reference, the raw secret (for manual entry), the provisioning URI, the QR code
   *   as a data URL, and when the registration expires.
   */
  async registerAuthenticatorFactor(actorId: string, options?: OtpOptions) {
    const otpOptions = { ...this.options.defaults, ...options };

    const secret = this.otpProvider.createSecret();

    const secretHash = this.encryptionProvider.encrypt(secret);

    const expiresAt = DateTime.utc().plus(this.options.registrationExpiration);

    const uri = this.otpProvider.generateURI(secret, otpOptions, { issuer: this.options.issuer });

    const qrCode = await toDataURL(uri);

    const payload = {
      actorId,
      secretHash,
      expiresAt: expiresAt.toUnixInteger(),
      issuedAt: DateTime.utc().toUnixInteger(),
      otpOptions,
    } as RegistrationPayload;

    const registrationId = await this.cacheRegistration(payload, this.options.registrationExpiration);

    return { registrationId, secret, uri, qrCode, expiresAt };
  }

  /**
   * Complete authenticator factor registration by verifying the first TOTP code
   * and persisting the factor.
   *
   * @param actorId        - The actor completing the registration (must match the
   *   actor that initiated it).
   * @param registrationId - The registration reference from {@link registerAuthenticatorFactor}.
   * @param code           - The current TOTP code from the user's authenticator app.
   * @returns The id of the newly created factor.
   * @throws HTTP 404 when the registration has expired or does not exist.
   * @throws HTTP 400 when `actorId` does not match the registration.
   * @throws HTTP 401 when the code is invalid.
   */
  async createAuthenticatorFactorFromRegistration(actorId: string, registrationId: string, code: string) {
    const payload = await this.lookupRegistration(registrationId);
    if (!payload) {
      throw httpError(404).withDetails({ registrationId: 'not found' });
    }

    if (payload.actorId !== actorId) {
      throw httpError(400).withDetails({ actorId: 'invalid actor' });
    }

    const secret = this.encryptionProvider.decrypt(payload.secretHash);

    if (!this.otpProvider.validate(code, secret, payload.otpOptions)) {
      throw unauthorizedError('Bearer error="invalid_code"');
    }

    const factor = await this.authenticatorFactorRepository.createFactor(actorId, { ...payload.otpOptions, secretHash: payload.secretHash });
    return factor.id;
  }

  /**
   * Verify a TOTP/HOTP code against an existing authenticator factor.
   *
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id to validate against.
   * @param code     - The current OTP code from the user's authenticator app.
   * @throws HTTP 401 when the factor does not exist, is inactive, or the code is invalid.
   */
  async validateFactor(actorId: string, factorId: string, code: string) {
    const factor = await this.authenticatorFactorRepository.getFactor(actorId, factorId);
    if (!factor || !factor.active) {
      throw unauthorizedError('Bearer error="invalid_factor"');
    }

    const secret = this.encryptionProvider.decrypt(factor.secretHash);

    if (!this.otpProvider.validate(code, secret, factor)) {
      throw unauthorizedError('Bearer error="invalid_code"');
    }
  }

  /**
   * Delete an authenticator factor.
   *
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The factor record id to delete.
   */
  async deleteFactor(actorId: string, factorId: string) {
    await this.authenticatorFactorRepository.deleteFactor(actorId, factorId);
  }
}
