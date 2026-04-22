import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { isEmail, binarySearch } from '@maroonedsoftware/utilities';
import { OtpProvider } from '../../providers/otp.provider.js';
import { httpError } from '@maroonedsoftware/errors';
import { CacheProvider } from '@maroonedsoftware/cache';
import { EmailFactorRepository } from './email.factor.repository.js';

type EmailPayload = {
  id: string;
  verificationMethod: 'code' | 'magiclink';
  secret?: string;
  code: string;
  expiresAt: number;
  issuedAt: number;
};

type VerificationPayload = EmailPayload & {
  actorId: string;
  factorId: string;
};

type RegistrationPayload = EmailPayload & {
  value: string;
};

/**
 * Configuration options for {@link EmailFactorService}.
 */
@Injectable()
export class EmailFactorServiceOptions {
  constructor(
    /** Domains to reject during registration (e.g. disposable email providers). Checked via binary search — keep sorted. */
    public readonly denyList: string[] = [],
    /** How long an OTP code-based registration or verification challenge remains valid. */
    public readonly otpExpiration: Duration = Duration.fromDurationLike({ minutes: 10 }),
    /** How long a magic link token remains valid. */
    public readonly magiclinkExpiration: Duration = Duration.fromDurationLike({ minutes: 30 }),
  ) {}
}

/**
 * Manages the lifecycle of email-based authentication factors, supporting both
 * OTP code and magic link verification flows.
 *
 * **Registration flow** (`code`):
 * 1. Call {@link registerEmailFactor} → receive a `registrationId` and a TOTP `code` to email to the user.
 * 2. Call {@link createEmailFactorFromRegistration} with the code the user submits → persists the factor.
 *
 * **Registration flow** (`magiclink`):
 * 1. Call {@link registerEmailFactor} → receive a `registrationId` and a one-time `code` token to embed in a link.
 * 2. Call {@link createEmailFactorFromRegistration} with the token from the link → persists the factor.
 *
 * **Verification flow** (signing in with an existing factor):
 * 1. Call {@link createEmailVerification} → receive a `verificationId` and a `code`/token to send.
 * 2. Call {@link verifyEmailVerification} → returns `actorId` and `factorId` on success.
 */
@Injectable()
export class EmailFactorService {
  constructor(
    private readonly options: EmailFactorServiceOptions,
    private readonly emailFactorRepository: EmailFactorRepository,
    private readonly otpProvider: OtpProvider,
    private readonly cache: CacheProvider,
  ) {}

  private getVerificationKey(key: string) {
    return `email_factor_verification_${key}`;
  }

  private getRegistrationKey(key: string) {
    return `email_factor_registration_${key}`;
  }

  private async lookupRegistration(registrationId: string) {
    const response = await this.cache.get(this.getRegistrationKey(registrationId));
    return response ? (JSON.parse(response) as RegistrationPayload) : undefined;
  }

  private async lookupRegistrationByValue(value: string) {
    const registrationId = await this.cache.get(this.getRegistrationKey(value));
    return registrationId ? await this.lookupRegistration(registrationId) : undefined;
  }

  private async cacheRegistration(value: string, payload: RegistrationPayload, expiration: Duration) {
    const registrationId = crypto.randomBytes(32).toString('base64url');

    payload.id = registrationId;

    await this.cache.set(this.getRegistrationKey(registrationId), JSON.stringify(payload), expiration);
    await this.cache.set(this.getRegistrationKey(value), registrationId, expiration);

    return registrationId;
  }

  private async lookupVerification(verificationId: string) {
    const response = await this.cache.get(this.getVerificationKey(verificationId));
    return response ? (JSON.parse(response) as VerificationPayload) : undefined;
  }

  private async cacheVerification(payload: VerificationPayload, expiration: Duration) {
    const verificationId = crypto.randomBytes(32).toString('base64url');
    payload.id = verificationId;
    await this.cache.set(this.getVerificationKey(verificationId), JSON.stringify(payload), expiration);
    return verificationId;
  }

  private createCode(expiration: Duration) {
    const secret = this.otpProvider.createSecret();
    const issuedAt = DateTime.utc();
    const code = this.otpProvider.generate(secret, { type: 'totp', periodSeconds: expiration.as('seconds'), tokenLength: 6, timestamp: issuedAt });

    return {
      code,
      secret,
      expiresAt: issuedAt.plus(expiration),
      issuedAt,
      expiration,
    };
  }

  private createToken(expiration: Duration) {
    const code = crypto.randomBytes(32).toString('base64url');
    const issuedAt = DateTime.utc();

    return {
      code,
      secret: '',
      expiresAt: issuedAt.plus(expiration),
      issuedAt,
      expiration,
    };
  }

  private createPayload<T extends EmailPayload>(verificationMethod: 'code' | 'magiclink') {
    const payload = { verificationMethod } as T;

    const result = verificationMethod === 'code' ? this.createCode(this.options.otpExpiration) : this.createToken(this.options.magiclinkExpiration);

    const expiresAt = result.expiresAt;

    payload.secret = result.secret;
    payload.code = result.code;
    payload.expiresAt = result.expiresAt.toUnixInteger();
    payload.issuedAt = result.issuedAt.toUnixInteger();

    return { payload, expiresAt, expiration: result.expiration };
  }

  private verifyPayload(payload: EmailPayload, code: string) {
    if (payload.verificationMethod === 'code') {
      if (
        !this.otpProvider.validate(
          code,
          payload.secret ?? '',
          { type: 'totp', periodSeconds: payload.expiresAt - payload.issuedAt, tokenLength: 6 },
          1,
        )
      ) {
        throw httpError(400).withDetails({ code: 'invalid code' });
      }
    } else if (payload.verificationMethod === 'magiclink' && payload.code !== code) {
      throw httpError(400).withDetails({ code: 'invalid magiclink' });
    }
  }

  /**
   * Initiate email factor registration by generating a verification code or magic link token
   * and caching a short-lived registration payload.
   *
   * The caller is responsible for sending the `code` to the user (e.g. via email).
   * Complete registration by calling {@link createEmailFactorFromRegistration}.
   *
   * @param value              - The email address to register.
   * @param verificationMethod - `"code"` for a TOTP-style numeric code; `"magiclink"` for a random token.
   * @param ignoreExisting     - When `true`, returns the existing pending registration instead of
   *   creating a duplicate if one is already cached.
   * @returns `{ registrationId, code, expiresAt }` — the registration reference, the code/token to send,
   *   and when the registration expires.
   * @throws HTTP 400 when the email format is invalid or the domain is on the deny list.
   * @throws HTTP 409 when `doesEmailExist` returns `false` (email not registered in the system).
   */
  async registerEmailFactor(value: string, verificationMethod: 'code' | 'magiclink', ignoreExisting: boolean = false) {
    if (!isEmail(value)) {
      throw httpError(400).withDetails({ value: 'invalid email format' });
    }

    const existingRegistration = await this.lookupRegistrationByValue(value);
    if (ignoreExisting && existingRegistration) {
      return { registrationId: existingRegistration.id, code: existingRegistration.code, expiresAt: existingRegistration.expiresAt };
    }

    const domain = value.split('@')[1];

    if (binarySearch(this.options.denyList, domain)) {
      throw httpError(400).withDetails({ email: 'Must not be a disposable email' });
    }

    const existingFactor = await this.emailFactorRepository.doesEmailExist(value);

    if (!existingFactor) {
      throw httpError(409).withDetails({ method: 'already registered' });
    }

    const { payload, expiresAt, expiration } = this.createPayload<RegistrationPayload>(verificationMethod);

    payload.value = value;

    const registrationId = await this.cacheRegistration(value, payload, expiration);

    return { registrationId, code: payload.code, expiresAt };
  }

  /**
   * Complete email factor registration by verifying the code/token and persisting the factor.
   *
   * @param actorId        - The actor to attach the factor to.
   * @param registrationId - The registration reference returned by {@link registerEmailFactor}.
   * @param code           - The code or magic link token submitted by the user.
   * @returns The newly persisted {@link EmailFactor}.
   * @throws HTTP 404 when the registration has expired or does not exist.
   * @throws HTTP 400 when the code/token is invalid.
   */
  async createEmailFactorFromRegistration(actorId: string, registrationId: string, code: string) {
    const payload = await this.lookupRegistration(registrationId);

    if (!payload) {
      throw httpError(404).withDetails({ registrationId: 'not found' });
    }

    this.verifyPayload(payload, code);

    return await this.emailFactorRepository.createFactor(actorId, payload.value, payload.verificationMethod);
  }

  /**
   * Initiate an email verification challenge for an existing, active factor.
   *
   * Generates a code or magic link token and caches a short-lived verification payload.
   * The caller is responsible for sending the `code` to the `email` address returned.
   * Complete verification by calling {@link verifyEmailVerification}.
   *
   * @param actorId            - The actor that owns the factor.
   * @param factorId           - The id of the email factor to verify against.
   * @param verificationMethod - `"code"` or `"magiclink"`.
   * @returns `{ email, verificationId, code, expiresAt }`.
   * @throws HTTP 404 when the factor does not exist or is not active.
   */
  async createEmailVerification(actorId: string, factorId: string, verificationMethod: 'code' | 'magiclink') {
    const factor = await this.emailFactorRepository.getFactor(actorId, factorId);
    if (!factor || !factor.active) {
      throw httpError(404).withDetails({ factorId: 'not found' });
    }
    const email = factor.value;

    const { payload, expiresAt, expiration } = this.createPayload<VerificationPayload>(verificationMethod);

    payload.actorId = actorId;
    payload.factorId = factorId;

    const verificationId = await this.cacheVerification(payload, expiration);

    return { email, verificationId, code: payload.code, expiresAt };
  }

  /**
   * Complete an email verification challenge.
   *
   * @param verificationId - The verification reference returned by {@link createEmailVerification}.
   * @param code           - The code or magic link token submitted by the user.
   * @returns `{ actorId, factorId }` identifying the actor and factor that was verified.
   * @throws HTTP 404 when the verification has expired or does not exist.
   * @throws HTTP 400 when the code/token is invalid.
   */
  async verifyEmailVerification(verificationId: string, code: string) {
    const payload = await this.lookupVerification(verificationId);
    if (!payload) {
      throw httpError(404).withDetails({ verificationId: 'not found' });
    }
    this.verifyPayload(payload, code);
    return { actorId: payload.actorId, factorId: payload.factorId };
  }
}
