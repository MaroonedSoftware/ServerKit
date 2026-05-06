import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { RateLimiterCompatibleAbstract } from 'rate-limiter-flexible';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';
import { PasswordFactorRepository, PasswordValue } from './password.factor.repository.js';
import { PasswordStrengthProvider } from '../../providers/password.strength.provider.js';
import { CacheProvider } from '@maroonedsoftware/cache';
import { DateTime, Duration } from 'luxon';

type RegistrationPayload = {
  id: string;
  hash: string;
  salt: string;
  expiresAt: number;
  issuedAt: number;
};

/**
 * Service for managing password-based authentication factors.
 *
 * Handles PBKDF2-SHA512 hashing, reuse prevention, and rate-limited
 * verification. Strength validation is delegated to {@link PasswordStrengthProvider}
 * (zxcvbn + HaveIBeenPwned by default) — register your own implementation to
 * override the policy.
 *
 * Two creation flows are supported:
 * - Direct: {@link createPasswordFactor} — strength-check and persist in one call.
 * - Two-step registration: {@link registerPasswordFactor} stages a hashed payload
 *   in the cache and returns a `registrationId`; {@link createPasswordFactorFromRegistration}
 *   binds it to an actor. This lets callers collect a password before the actor
 *   record exists (e.g. during a sign-up flow that also verifies an email).
 */
@Injectable()
export class PasswordFactorService {
  constructor(
    private readonly passwordFactorRepository: PasswordFactorRepository,
    private readonly rateLimiter: RateLimiterCompatibleAbstract,
    private readonly passwordStrengthProvider: PasswordStrengthProvider,
    private readonly cache: CacheProvider,
  ) {}

  private getRegistrationKey(key: string) {
    return `password_factor_registration_${key}`;
  }

  private async lookupRegistration(registrationId: string) {
    const response = await this.cache.get(this.getRegistrationKey(registrationId));
    return response ? (JSON.parse(response) as RegistrationPayload) : undefined;
  }

  private async lookupRegistrationByValue(value: string) {
    const registrationId = await this.cache.get(this.getRegistrationKey(value));
    return registrationId ? await this.lookupRegistration(registrationId) : undefined;
  }

  private hashPassword(password: string, salt?: Buffer): PasswordValue {
    salt ??= crypto.randomBytes(32);
    const hash = crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512');
    return { hash: hash.toString('base64'), salt: salt.toString('base64') };
  }

  private comparePassword(password: string, hash: string, salt: string) {
    const saltBuffer = Buffer.from(salt, 'base64');
    const hashPwd = crypto.pbkdf2Sync(password, saltBuffer, 210000, 64, 'sha512');
    return hashPwd.toString('base64') === hash;
  }

  private async cacheRegistration(value: string, payload: RegistrationPayload, expiration: Duration) {
    const registrationId = payload.id ?? crypto.randomBytes(32).toString('base64url');

    payload.id = registrationId;

    await this.cache.set(this.getRegistrationKey(registrationId), JSON.stringify(payload), expiration);
    await this.cache.set(this.getRegistrationKey(value), registrationId, expiration);
    return registrationId;
  }

  /**
   * Stage a password registration without yet binding it to an actor.
   *
   * Validates strength, hashes the password, and caches the salted hash under a
   * fresh `registrationId` for 10 minutes. The caller completes registration by
   * calling {@link createPasswordFactorFromRegistration} with that id once the
   * actor record exists.
   *
   * Idempotent in two ways:
   * - If `registrationId` is supplied and resolves to a cached registration,
   *   that registration is returned. Useful for retrying without churning the
   *   id (e.g. when stitching this flow into a longer onboarding state machine).
   * - Otherwise, if a pending registration is already cached for the same
   *   password (matched by hash + salt), the existing `registrationId` is
   *   returned. Useful for retrying a sign-up without re-staging the same secret.
   *
   * In both cases `alreadyRegistered` is set to `true`.
   *
   * @param password       - The plaintext password to stage.
   * @param registrationId - Optional caller-supplied id. When set, the method
   *   first checks for a cached registration under this id before falling back
   *   to the password-keyed lookup; on a cache miss it is also used as the id
   *   of the freshly cached registration.
   * @returns `{ registrationId, expiresAt, issuedAt, alreadyRegistered }` —
   *   the registration reference, when it expires, when it was originally
   *   issued (both as Luxon `DateTime`s), and whether this call hit a
   *   previously-cached registration.
   * @throws HTTP 400 when the password fails the configured strength policy.
   */
  async registerPasswordFactor(password: string, registrationId?: string) {
    await this.passwordStrengthProvider.ensureStrength(password);

    const { hash, salt } = this.hashPassword(password);
    const existingRegistration = registrationId
      ? await this.lookupRegistration(registrationId)
      : await this.lookupRegistrationByValue(`${hash}:${salt}`);
    if (existingRegistration) {
      return {
        registrationId: existingRegistration.id,
        expiresAt: DateTime.fromSeconds(existingRegistration.expiresAt),
        issuedAt: DateTime.fromSeconds(existingRegistration.issuedAt),
        alreadyRegistered: true,
      };
    }

    const payload = {
      id: registrationId,
      hash,
      salt,
      expiresAt: DateTime.utc()
        .plus(Duration.fromDurationLike({ minutes: 10 }))
        .toUnixInteger(),
      issuedAt: DateTime.utc().toUnixInteger(),
    } as RegistrationPayload;

    registrationId = await this.cacheRegistration(`${hash}:${salt}`, payload, Duration.fromDurationLike({ minutes: 10 }));
    return {
      registrationId,
      expiresAt: DateTime.fromSeconds(payload.expiresAt),
      issuedAt: DateTime.fromSeconds(payload.issuedAt),
      alreadyRegistered: false,
    };
  }

  /**
   * Complete a staged registration by attaching the cached password hash to an actor.
   *
   * On success the cached registration entries (under both the registration id
   * and the password hash) are deleted so the registration cannot be replayed.
   * The persisted factor is created with `needsReset = false`.
   *
   * Unlike {@link createPasswordFactor}, this method does not re-check strength
   * (already validated at staging time) and does not check for an existing
   * factor on the actor — callers that need that guarantee should enforce it
   * themselves before invoking this method.
   *
   * @param actorId        - The actor to attach the factor to.
   * @param registrationId - The registration reference returned by {@link registerPasswordFactor}.
   * @returns The newly persisted {@link PasswordFactor}.
   * @throws HTTP 404 when the registration has expired or does not exist.
   */
  async createPasswordFactorFromRegistration(actorId: string, registrationId: string) {
    const registration = await this.lookupRegistration(registrationId);
    if (!registration) {
      throw httpError(404).withDetails({ registrationId: 'not found' });
    }

    const factor = await this.passwordFactorRepository.createFactor(actorId, { hash: registration.hash, salt: registration.salt }, false);

    await this.cache.delete(this.getRegistrationKey(registrationId));
    await this.cache.delete(this.getRegistrationKey(`${registration.hash}:${registration.salt}`));

    return factor;
  }

  /**
   * Check whether a registration is still pending (i.e. cached and not yet expired).
   *
   * @param registrationId - The registration reference returned by {@link registerPasswordFactor}.
   * @returns `true` if the registration exists and has not expired, `false` otherwise.
   */
  async hasPendingRegistration(registrationId: string) {
    return (await this.lookupRegistration(registrationId)) !== undefined;
  }

  /**
   * Creates a new password factor after validating strength. Throws 409 if the actor already has one.
   *
   * @returns The newly persisted {@link PasswordFactor}.
   */
  async createPasswordFactor(actorId: string, password: string, needsReset: boolean = false) {
    await this.passwordStrengthProvider.ensureStrength(password);

    const existingFactor = await this.passwordFactorRepository.getFactor(actorId);
    if (existingFactor) {
      throw httpError(409).withDetails({ actorId: 'Password factor already exists' });
    }

    const value = this.hashPassword(password);
    const factor = await this.passwordFactorRepository.createFactor(actorId, value, needsReset);
    return factor;
  }

  /**
   * Replaces the actor's password after validating strength and checking the last 10 passwords for reuse.
   *
   * @returns The updated {@link PasswordFactor}.
   */
  async updatePasswordFactor(actorId: string, password: string, needsReset: boolean = false) {
    await this.passwordStrengthProvider.ensureStrength(password);

    let factor = await this.passwordFactorRepository.getFactor(actorId);
    if (!factor) {
      throw httpError(404).withDetails({ actorId: 'Password factor not found' });
    }

    const previousPasswords = await this.passwordFactorRepository.listPreviousPasswords(actorId, 10);
    if (previousPasswords.some(p => this.comparePassword(password, p.hash, p.salt))) {
      throw httpError(400).withDetails({ password: 'Password is the same as a previous one' });
    }
    factor = await this.passwordFactorRepository.updateFactor(actorId, this.hashPassword(password), needsReset);
    return factor;
  }

  /** Permanently removes the actor's password factor. */
  async deleteFactor(actorId: string) {
    await this.passwordFactorRepository.deleteFactor(actorId);
  }

  /**
   * Verifies the actor's password against the stored hash, enforcing rate limiting.
   * Throws 429 when rate-limited, 401 when the factor is missing/inactive, needs reset, or the password is wrong.
   *
   * @returns The verified {@link PasswordFactor} on success.
   */
  async verifyPassword(actorId: string, password: string) {
    try {
      await this.rateLimiter.consume(actorId);
    } catch (error) {
      throw httpError(429)
        .withInternalDetails({ message: `password authentication has been rate limited for actor: ${actorId}` })
        .withCause(error as Error);
    }

    const passwordFactor = await this.passwordFactorRepository.getFactor(actorId);

    if (!passwordFactor || !passwordFactor.active) {
      throw unauthorizedError('Bearer error="invalid_factor"').withInternalDetails({ message: `${actorId} missing active password factor` });
    }

    if (passwordFactor.needsReset) {
      throw unauthorizedError('Bearer error="reset_password"').withInternalDetails({ message: `${actorId} needs to reset password` });
    }

    if (!this.comparePassword(password, passwordFactor.value.hash, passwordFactor.value.salt)) {
      throw unauthorizedError('Bearer error="invalid_credentials"').withInternalDetails({ message: `${actorId} invalid password attempt` });
    }

    await this.rateLimiter.reward(actorId);
    return passwordFactor;
  }

  /**
   * Changes the actor's password and clears the `needsReset` flag. Validates strength before persisting.
   *
   * @returns The updated {@link PasswordFactor}.
   */
  async changePassword(actorId: string, password: string) {
    await this.passwordStrengthProvider.ensureStrength(password);

    const passwordFactor = await this.passwordFactorRepository.getFactor(actorId);
    if (!passwordFactor) {
      throw httpError(404).withDetails({ actorId: 'Password factor not found' });
    }

    const value = this.hashPassword(password);
    const updatedFactor = await this.passwordFactorRepository.updateFactor(actorId, value, false);
    return updatedFactor;
  }

  /**
   * Evaluate the strength of a password without throwing.
   *
   * Pass-through to the injected {@link PasswordStrengthProvider} for callers
   * that want to surface live strength feedback (e.g. a sign-up form meter)
   * without taking a separate dependency on the provider.
   *
   * @param password   - The password to evaluate.
   * @param userInputs - Additional strings or numbers to penalise if found in the
   *   password (e.g. the user's name, email, or date of birth).
   * @returns `{ valid, score, feedback }` — `valid` is `true` when `score >= 3`.
   */
  async checkPasswordStrength(password: string, ...userInputs: (string | number)[]) {
    return this.passwordStrengthProvider.checkStrength(password, ...userInputs);
  }

  /**
   * Assert that a password meets the configured strength threshold, throwing on failure.
   *
   * Pass-through to the injected {@link PasswordStrengthProvider}.
   *
   * @param password   - The password to evaluate.
   * @param userInputs - Additional context values to penalise (see {@link checkPasswordStrength}).
   * @throws HTTP 400 with `{ password: warning, suggestions: [...] }` details when the score is below threshold.
   */
  async ensurePasswordStrength(password: string, ...userInputs: (string | number)[]) {
    await this.passwordStrengthProvider.ensureStrength(password, ...userInputs);
  }

  /**
   * Clear the rate limiter counter for an actor.
   *
   * Useful after an out-of-band recovery (e.g. successful magic-link sign-in
   * or admin unlock) so the next password attempt isn't blocked by 429s
   * accumulated from the failed attempts that triggered the recovery.
   */
  async clearRateLimit(actorId: string) {
    await this.rateLimiter.delete(actorId);
  }
}
