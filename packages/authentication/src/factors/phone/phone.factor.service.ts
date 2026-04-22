import crypto from 'node:crypto';
import { DateTime, Duration } from 'luxon';
import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { CacheProvider } from '@maroonedsoftware/cache';
import { isPhoneE164 } from '@maroonedsoftware/utilities';
import { PhoneFactorRepository } from './phone.factor.repository.js';

/**
 * Configuration options for {@link PhoneFactorService}.
 */
@Injectable()
export class PhoneFactorServiceOptions {
  constructor(
    /**
     * How long a pending registration remains valid before it must be completed.
     */
    public readonly otpExpiration: Duration = Duration.fromDurationLike({ minutes: 10 }),
  ) {}
}

type RegistrationPayload = {
  id: string;
  actorId: string;
  value: string;
  expiresAt: number;
  issuedAt: number;
};

/**
 * Manages the lifecycle of phone number factors.
 *
 * **Registration flow:**
 * 1. Call {@link registerPhoneFactor} — validates the phone number and caches a
 *    pending registration. Returns a `registrationId` and `expiresAt`. Send an
 *    OTP to the phone number out-of-band using the `registrationId` as the
 *    reference.
 * 2. Call {@link createPhoneFactorFromRegistration} once the user has verified
 *    their number — persists the factor.
 *
 * Registration is idempotent: calling {@link registerPhoneFactor} again for the
 * same actor and phone number returns the existing pending registration rather
 * than creating a duplicate.
 */
@Injectable()
export class PhoneFactorService {
  constructor(
    private readonly options: PhoneFactorServiceOptions,
    private readonly phoneFactorRepository: PhoneFactorRepository,
    private readonly cache: CacheProvider,
  ) {}

  private getRegistrationKey(key: string) {
    return `phone_factor_registration_${key}`;
  }

  private async lookupRegistration(registrationId: string) {
    const response = await this.cache.get(this.getRegistrationKey(registrationId));
    return response ? (JSON.parse(response) as RegistrationPayload) : undefined;
  }

  private async lookupRegistrationByValue(actorId: string, value: string) {
    const registrationId = await this.cache.get(this.getRegistrationKey(`${actorId}_${value}`));
    return registrationId ? await this.lookupRegistration(registrationId) : undefined;
  }

  private async cacheRegistration(actorId: string, payload: RegistrationPayload, expiration: Duration) {
    const registrationId = crypto.randomBytes(32).toString('base64url');

    payload.id = registrationId;

    await this.cache.set(this.getRegistrationKey(registrationId), JSON.stringify(payload), expiration);
    await this.cache.set(this.getRegistrationKey(`${actorId}_${payload.value}`), registrationId, expiration);

    return registrationId;
  }

  /**
   * Initiate phone factor registration for an actor.
   *
   * Validates the phone number, checks for an existing pending registration or a
   * previously registered factor, then caches a new registration payload. The
   * caller is responsible for sending an OTP to the phone number out-of-band.
   *
   * Registration is idempotent — calling this method again with the same actor
   * and phone number returns the existing pending registration.
   *
   * @param actorId - The actor registering the factor.
   * @param value   - The phone number in E.164 format (e.g. `+12025550123`).
   * @returns `{ registrationId, expiresAt }` — the registration reference and
   *   when it expires (Unix timestamp).
   * @throws HTTP 400 when `value` is not a valid E.164 phone number.
   * @throws HTTP 409 when the phone number is already registered as a factor for this actor.
   */
  async registerPhoneFactor(actorId: string, value: string) {
    if (!isPhoneE164(value)) {
      throw httpError(400).withDetails({ value: 'invalid E.164 format' });
    }

    const existingRegistration = await this.lookupRegistrationByValue(actorId, value);
    if (existingRegistration) {
      return { registrationId: existingRegistration.id, expiresAt: existingRegistration.expiresAt };
    }

    const existingFactor = await this.phoneFactorRepository.findFactor(actorId, value);

    if (existingFactor) {
      throw httpError(409).withDetails({ value: 'already registered' });
    }

    const payload = {
      actorId,
      value,
      expiresAt: DateTime.utc().plus(this.options.otpExpiration).toUnixInteger(),
      issuedAt: DateTime.utc().toUnixInteger(),
    } as RegistrationPayload;

    const registrationId = await this.cacheRegistration(actorId, payload, this.options.otpExpiration);

    return {
      registrationId,
      expiresAt: payload.expiresAt,
    };
  }

  /**
   * Complete phone factor registration by persisting the factor.
   *
   * @param actorId        - The actor completing the registration (must match
   *   the actor that initiated it).
   * @param registrationId - The registration reference from {@link registerPhoneFactor}.
   * @returns The id of the newly created factor.
   * @throws HTTP 404 when the registration has expired or does not exist.
   * @throws HTTP 400 when `actorId` does not match the registration.
   */
  async createPhoneFactorFromRegistration(actorId: string, registrationId: string) {
    const payload = await this.lookupRegistration(registrationId);
    if (!payload) {
      throw httpError(404).withDetails({ registrationId: 'not found' });
    }

    if (payload.actorId !== actorId) {
      throw httpError(400).withDetails({ actorId: 'invalid actor' });
    }

    const factor = await this.phoneFactorRepository.createFactor(payload.actorId, payload.value);

    return factor.id;
  }
}
