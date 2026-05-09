import crypto from 'node:crypto';
import { DateTime, Duration } from 'luxon';
import { Injectable } from 'injectkit';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';
import { CacheProvider } from '@maroonedsoftware/cache';
import { PhoneFactorRepository } from './phone.factor.repository.js';
import { PolicyService } from '@maroonedsoftware/policies';
import { OtpProvider } from '../../providers/otp.provider.js';

/**
 * Configuration options for {@link PhoneFactorService}.
 */
@Injectable()
export class PhoneFactorServiceOptions {
  constructor(
    /**
     * How long a pending registration or sign-in challenge remains valid before it must be completed.
     */
    public readonly otpExpiration: Duration = Duration.fromDurationLike({ minutes: 10 }),
    /** Length of the generated OTP code, in digits. Defaults to 6. */
    public readonly tokenLength: number = 6,
  ) {}
}

type PhonePayload = {
  id: string;
  secret: string;
  code: string;
  expiresAt: number;
  issuedAt: number;
};

type IssuePayload = PhonePayload & {
  actorId: string;
  factorId: string;
};

type RegistrationPayload = PhonePayload & {
  value: string;
};

/**
 * Manages the lifecycle of phone number factors, supporting both registration
 * and sign-in challenge flows backed by a TOTP code.
 *
 * **Registration flow:**
 * 1. Call {@link registerPhoneFactor} — validates the phone number, generates a
 *    TOTP `code`, and caches a pending registration. Send the code to the phone
 *    number out-of-band (e.g. via SMS).
 * 2. Call {@link createPhoneFactorFromRegistration} with the actor id and the
 *    code the user submitted — persists the factor.
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
 *
 * **Verification flow** (signing in with an existing factor):
 * 1. Call {@link issuePhoneChallenge} — generates a `challengeId` and a fresh
 *    code and caches the challenge. Send the code via SMS.
 * 2. Call {@link verifyPhoneChallenge} → returns the verified {@link PhoneFactor} on success.
 */
@Injectable()
export class PhoneFactorService {
  constructor(
    private readonly options: PhoneFactorServiceOptions,
    private readonly phoneFactorRepository: PhoneFactorRepository,
    private readonly otpProvider: OtpProvider,
    private readonly cache: CacheProvider,
    private readonly policyService: PolicyService,
  ) {}

  private getChallengeKey(key: string) {
    return `phone_factor_challenge_${key}`;
  }

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

  private async lookupChallenge(challengeId: string) {
    const response = await this.cache.get(this.getChallengeKey(challengeId));
    return response ? (JSON.parse(response) as IssuePayload) : undefined;
  }

  private async lookupChallengeByActorAndFactor(actorId: string, factorId: string) {
    const challengeId = await this.cache.get(this.getChallengeKey(`${actorId}_${factorId}`));
    return challengeId ? await this.lookupChallenge(challengeId) : undefined;
  }

  private async cacheChallenge(payload: IssuePayload, expiration: Duration) {
    const challengeId = crypto.randomBytes(32).toString('base64url');
    payload.id = challengeId;
    await this.cache.set(this.getChallengeKey(challengeId), JSON.stringify(payload), expiration);
    await this.cache.set(this.getChallengeKey(`${payload.actorId}_${payload.factorId}`), challengeId, expiration);
    return challengeId;
  }

  private createCode(expiration: Duration) {
    const secret = this.otpProvider.createSecret();
    const issuedAt = DateTime.utc();
    const code = this.otpProvider.generate(secret, {
      type: 'totp',
      periodSeconds: expiration.as('seconds'),
      tokenLength: this.options.tokenLength,
      timestamp: issuedAt,
    });

    return {
      code,
      secret,
      expiresAt: issuedAt.plus(expiration),
      issuedAt,
      expiration,
    };
  }

  private createPayload<T extends PhonePayload>(registrationId?: string) {
    const payload = { id: registrationId } as T;

    const result = this.createCode(this.options.otpExpiration);

    const expiresAt = result.expiresAt;
    const issuedAt = result.issuedAt;

    payload.secret = result.secret;
    payload.code = result.code;
    payload.expiresAt = expiresAt.toUnixInteger();
    payload.issuedAt = issuedAt.toUnixInteger();

    return { payload, expiresAt, issuedAt, expiration: result.expiration };
  }

  private verifyPayload(payload: PhonePayload, code: string) {
    if (
      !this.otpProvider.validate(
        code,
        payload.secret ?? '',
        { type: 'totp', periodSeconds: payload.expiresAt - payload.issuedAt, tokenLength: this.options.tokenLength },
        1,
      )
    ) {
      throw httpError(400).withDetails({ code: 'invalid code' });
    }
  }

  /**
   * Stage a phone factor registration without yet binding it to an actor.
   *
   * Validates the phone number, generates a TOTP `code`, and caches a pending
   * registration. The caller is responsible for sending the `code` to the phone
   * number out-of-band (e.g. via SMS), then calling
   * {@link createPhoneFactorFromRegistration} with the actor id and the code
   * the user submitted.
   *
   * Idempotent: calling this method again with the same phone number — or
   * supplying the same `registrationId` — returns the existing pending
   * registration with `alreadyRegistered: true` (and the same `code`), so
   * callers can suppress duplicate SMS sends.
   *
   * @param value          - The phone number in E.164 format (e.g. `+12025550123`).
   * @param registrationId - Optional caller-supplied id. When set, the method
   *   first checks for a cached registration under this id before falling back
   *   to the value-keyed lookup; on a cache miss it is also used as the id of
   *   the freshly cached registration.
   * @returns `{ registrationId, code, expiresAt, issuedAt, alreadyRegistered }` —
   *   the registration reference, the OTP code to send, when the registration
   *   expires and was originally issued (both as Luxon `DateTime`s), and
   *   whether this call hit a previously-cached pending registration.
   * @throws HTTP 400 when `value` is not a valid E.164 phone number or the
   *   `phone.allowed` policy denies the number.
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
        registrationId: existingRegistration.id,
        code: existingRegistration.code,
        expiresAt: DateTime.fromSeconds(existingRegistration.expiresAt),
        issuedAt: DateTime.fromSeconds(existingRegistration.issuedAt),
        alreadyRegistered: true,
      };
    }

    const { payload, expiresAt, issuedAt, expiration } = this.createPayload<RegistrationPayload>(registrationId);

    payload.value = value;

    registrationId = await this.cacheRegistration(value, payload, expiration);

    return {
      registrationId,
      code: payload.code,
      expiresAt,
      issuedAt,
      alreadyRegistered: false,
    };
  }

  /**
   * Complete phone factor registration by verifying the OTP code and binding
   * the cached phone number to an actor.
   *
   * On success the cached registration entries (under both the registration id
   * and the phone number) are deleted so the code cannot be replayed.
   *
   * @param actorId        - The actor to attach the factor to.
   * @param registrationId - The registration reference from {@link registerPhoneFactor}.
   * @param code           - The OTP code submitted by the user.
   * @returns The newly persisted {@link PhoneFactor}.
   * @throws HTTP 404 when the registration has expired or does not exist.
   * @throws HTTP 400 when the OTP code is invalid.
   */
  async createPhoneFactorFromRegistration(actorId: string, registrationId: string, code: string) {
    const payload = await this.lookupRegistration(registrationId);
    if (!payload) {
      throw httpError(404).withDetails({ registrationId: 'not found' });
    }

    this.verifyPayload(payload, code);

    const factor = await this.phoneFactorRepository.createFactor(actorId, payload.value);

    await this.cache.delete(this.getRegistrationKey(registrationId));
    await this.cache.delete(this.getRegistrationKey(payload.value));

    return factor;
  }

  /**
   * Initiate a sign-in challenge for an existing, active phone factor.
   *
   * Generates a TOTP `code` and caches a short-lived challenge payload. The
   * caller is responsible for sending the `code` to the `phone` number returned.
   * Complete the challenge by calling {@link verifyPhoneChallenge}.
   *
   * Idempotent: if a pending challenge is already cached for this actor+factor
   * pair, the existing `challengeId` and `code` are returned and `alreadyIssued`
   * is set to `true`. Use this flag to suppress duplicate SMS sends.
   *
   * @param actorId  - The actor that owns the factor.
   * @param factorId - The id of the phone factor to verify against.
   * @returns `{ phone, challengeId, code, expiresAt, issuedAt, alreadyIssued }` —
   *   the phone number on file, the challenge reference, the code to send,
   *   when the challenge expires and was originally issued (both as Luxon
   *   `DateTime`s), and whether this call hit a previously-cached pending
   *   challenge.
   * @throws HTTP 404 when the factor does not exist or is not active.
   */
  async issuePhoneChallenge(actorId: string, factorId: string) {
    const factor = await this.phoneFactorRepository.getFactor(actorId, factorId);
    if (!factor || !factor.active) {
      throw httpError(404).withDetails({ factorId: 'not found' });
    }
    const phone = factor.value;

    const existingChallenge = await this.lookupChallengeByActorAndFactor(actorId, factorId);
    if (existingChallenge) {
      return {
        phone,
        challengeId: existingChallenge.id,
        code: existingChallenge.code,
        expiresAt: DateTime.fromSeconds(existingChallenge.expiresAt),
        issuedAt: DateTime.fromSeconds(existingChallenge.issuedAt),
        alreadyIssued: true,
      };
    }

    const { payload, expiresAt, issuedAt, expiration } = this.createPayload<IssuePayload>();

    payload.actorId = actorId;
    payload.factorId = factorId;

    const challengeId = await this.cacheChallenge(payload, expiration);

    return { phone, challengeId, code: payload.code, expiresAt, issuedAt, alreadyIssued: false };
  }

  /**
   * Complete a phone sign-in challenge.
   *
   * On success the cached challenge entries (under both the challenge id and
   * the actor+factor pair) are deleted so the code cannot be replayed.
   *
   * The factor is re-loaded and re-checked for `active = true` before the code
   * is verified, so a factor deactivated between {@link issuePhoneChallenge}
   * and this call cannot be used to authenticate.
   *
   * @param challengeId - The challenge reference returned by {@link issuePhoneChallenge}.
   * @param code        - The OTP code submitted by the user.
   * @returns The verified {@link PhoneFactor}.
   * @throws HTTP 404 when the challenge has expired or does not exist.
   * @throws HTTP 401 (`WWW-Authenticate: Bearer error="invalid_factor"`) when
   *   the factor has been deleted or deactivated since the challenge was issued.
   * @throws HTTP 400 when the OTP code is invalid.
   */
  async verifyPhoneChallenge(challengeId: string, code: string) {
    const payload = await this.lookupChallenge(challengeId);
    if (!payload) {
      throw httpError(404).withDetails({ challengeId: 'not found' });
    }

    const factor = await this.phoneFactorRepository.getFactor(payload.actorId, payload.factorId);
    if (!factor || !factor.active) {
      throw unauthorizedError('Bearer error="invalid_factor"');
    }

    this.verifyPayload(payload, code);

    await this.cache.delete(this.getChallengeKey(challengeId));
    await this.cache.delete(this.getChallengeKey(`${payload.actorId}_${payload.factorId}`));

    return factor;
  }

  /**
   * Check whether a challenge is still pending (i.e. cached and not yet expired).
   *
   * Useful for UI flows that want to skip re-issuing a code when the user has merely
   * navigated away and come back to the verification screen.
   *
   * @param challengeId - The challenge reference returned by {@link issuePhoneChallenge}.
   * @returns `true` if the challenge exists and has not expired, `false` otherwise.
   */
  async hasPendingChallenge(challengeId: string) {
    return (await this.lookupChallenge(challengeId)) !== undefined;
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
