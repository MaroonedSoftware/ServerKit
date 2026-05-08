import crypto from 'node:crypto';
import { DateTime, Duration } from 'luxon';
import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { CacheProvider } from '@maroonedsoftware/cache';
import { PhoneFactorRepository } from './phone.factor.repository.js';
import { PolicyService } from '@maroonedsoftware/policies';

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
  value: string;
  expiresAt: number;
  issuedAt: number;
};

/**
 * Manages the lifecycle of phone number factors.
 *
 * **Registration flow:**
 * 1. Call {@link registerPhoneFactor} — validates the phone number and caches a
 *    pending registration. Returns a `registrationId`, `expiresAt`, `issuedAt`,
 *    and `alreadyRegistered`. Send an OTP to the phone number out-of-band using
 *    the `registrationId` as the reference.
 * 2. Call {@link createPhoneFactorFromRegistration} with the actor id once the
 *    user has verified their number — persists the factor.
 *
 * Registration is decoupled from the actor: it stages a phone number, not an
 * (actor, phone number) pair. The actor is bound at completion time, which
 * lets the same flow drive sign-up (no actor exists yet), profile updates,
 * and recovery (where the actor is resolved by other means).
 *
 * Registration is idempotent: calling {@link registerPhoneFactor} again for the
 * same phone number — or supplying the same `registrationId` — returns the
 * existing pending registration rather than creating a duplicate, so callers
 * can suppress duplicate SMS sends.
 */
@Injectable()
export class PhoneFactorService {
  constructor(
    private readonly options: PhoneFactorServiceOptions,
    private readonly phoneFactorRepository: PhoneFactorRepository,
    private readonly cache: CacheProvider,
    private readonly policyService: PolicyService,
  ) {}

  private getRegistrationKey(key: string) {
    return `phone_factor_registration_${key}`;
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
    const registrationId = payload.id ?? crypto.randomBytes(32).toString('base64url');

    payload.id = registrationId;

    await this.cache.set(this.getRegistrationKey(registrationId), JSON.stringify(payload), expiration);
    await this.cache.set(this.getRegistrationKey(value), registrationId, expiration);

    return registrationId;
  }

  /**
   * Stage a phone factor registration without yet binding it to an actor.
   *
   * Validates the phone number and caches a pending registration. The caller
   * is responsible for sending an OTP to the phone number out-of-band (e.g.
   * via SMS) using the `registrationId` as the reference, then calling
   * {@link createPhoneFactorFromRegistration} with the actor id once the user
   * has verified the number.
   *
   * Idempotent: calling this method again with the same phone number — or
   * supplying the same `registrationId` — returns the existing pending
   * registration with `alreadyRegistered: true`.
   *
   * @param value          - The phone number in E.164 format (e.g. `+12025550123`).
   * @param registrationId - Optional caller-supplied id. When set, the method
   *   first checks for a cached registration under this id before falling back
   *   to the value-keyed lookup; on a cache miss it is also used as the id of
   *   the freshly cached registration.
   * @returns `{ value, registrationId, expiresAt, issuedAt, alreadyRegistered }` —
   *   the (normalized) phone number, the registration reference, when it
   *   expires and was originally issued (both as Luxon `DateTime`s), and
   *   whether this call hit a previously-cached pending registration (use this
   *   flag to suppress duplicate SMS sends).
   * @throws HTTP 400 when `value` is not a valid E.164 phone number.
   */
  async registerPhoneFactor(value: string, registrationId?: string) {
    const policyResult = await this.policyService.check('phone.allowed', { value });
    if (!policyResult.allowed) {
      const msg =
        policyResult.reason === 'deny_list'
          ? 'phone number is not allowed'
          : policyResult.reason === 'invalid_format'
            ? 'invalid phone number, expected E.164 format'
            : policyResult.reason;
      throw httpError(400).withDetails({ value: msg }).withInternalDetails({ value: policyResult.details?.value });
    }

    const existingRegistration = registrationId ? await this.lookupRegistration(registrationId) : await this.lookupRegistrationByValue(value);
    if (existingRegistration) {
      return {
        value: existingRegistration.value,
        registrationId: existingRegistration.id,
        expiresAt: DateTime.fromSeconds(existingRegistration.expiresAt),
        issuedAt: DateTime.fromSeconds(existingRegistration.issuedAt),
        alreadyRegistered: true,
      };
    }

    const payload = {
      id: registrationId,
      value,
      expiresAt: DateTime.utc().plus(this.options.otpExpiration).toUnixInteger(),
      issuedAt: DateTime.utc().toUnixInteger(),
    } as RegistrationPayload;

    registrationId = await this.cacheRegistration(value, payload, this.options.otpExpiration);

    return {
      value,
      registrationId,
      expiresAt: DateTime.fromSeconds(payload.expiresAt),
      issuedAt: DateTime.fromSeconds(payload.issuedAt),
      alreadyRegistered: false,
    };
  }

  /**
   * Complete phone factor registration by binding the cached phone number to
   * an actor and persisting the factor.
   *
   * On success the cached registration entries (under both the registration id
   * and the phone number) are deleted so the registration cannot be replayed.
   *
   * @param actorId        - The actor to attach the factor to.
   * @param registrationId - The registration reference from {@link registerPhoneFactor}.
   * @returns The newly persisted {@link PhoneFactor}.
   * @throws HTTP 404 when the registration has expired or does not exist.
   */
  async createPhoneFactorFromRegistration(actorId: string, registrationId: string) {
    const payload = await this.lookupRegistration(registrationId);
    if (!payload) {
      throw httpError(404).withDetails({ registrationId: 'not found' });
    }

    const factor = await this.phoneFactorRepository.createFactor(actorId, payload.value);

    await this.cache.delete(this.getRegistrationKey(registrationId));
    await this.cache.delete(this.getRegistrationKey(payload.value));

    return factor;
  }

  /**
   * Check whether a registration is still pending (i.e. cached and not yet expired).
   *
   * Useful for UI flows that want to skip re-sending the SMS when the user has merely
   * navigated back to the verification screen.
   *
   * @param registrationId - The registration reference returned by {@link registerPhoneFactor}.
   * @returns `true` if the registration exists and has not expired, `false` otherwise.
   */
  async hasPendingRegistration(registrationId: string) {
    return (await this.lookupRegistration(registrationId)) !== undefined;
  }
}
