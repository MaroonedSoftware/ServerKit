import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { CacheProvider } from '@maroonedsoftware/cache';
import { Logger } from '@maroonedsoftware/logger';
import { isPolicyResultDenied, PolicyService } from '@maroonedsoftware/policies';
import { RateLimiterCompatibleAbstract } from 'rate-limiter-flexible';
import { OtpProvider, type TotpOptions } from '../providers/otp.provider.js';
import { TargetActor } from '../mfa/types.js';
import {
  SupportVerificationSecret,
  SupportVerificationSecretRepository,
} from './support.verification.secret.repository.js';
import { SupportVerificationIssueResult, SupportVerificationVerifyResult } from './types.js';

/**
 * Configuration options for {@link SupportVerificationCodeService}.
 */
@Injectable()
export class SupportVerificationCodeServiceOptions {
  constructor(
    /** Default TOTP algorithm options applied when generating a new actor secret. */
    public readonly defaults: TotpOptions = {
      type: 'totp',
      algorithm: 'SHA1',
      periodSeconds: 30,
      tokenLength: 6,
    },
    /**
     * Number of TOTP periods either side of the current period that are
     * accepted on verify. Mirrors the `window` parameter of
     * {@link OtpProvider.validate}. A window of `1` tolerates ±1 period of
     * clock drift (default — recommended).
     */
    public readonly driftWindow: number = 1,
  ) {}
}

/**
 * Issues and verifies a short, rotating support-verification code for an
 * actor.
 *
 * **Use case:** when a user calls customer support, the application displays
 * the current code; the support agent enters it in their internal tool and
 * the server confirms the agent is speaking with the authenticated account
 * holder. This is **not** an authentication factor — it grants no access on
 * its own; it is an out-of-band identity assertion that the user is the one
 * holding the device the code is being read from.
 *
 * **Code mechanism:** standard TOTP via {@link OtpProvider}. A per-actor
 * secret is generated lazily on first {@link issueCode} and stored encrypted
 * via {@link EncryptionProvider}. The code rotates every `periodSeconds`
 * (30s by default). On verify, codes are accepted within ±`driftWindow`
 * periods of the current time to tolerate clock skew between the user's and
 * server's clocks.
 *
 * **Replay protection:** once a code is successfully verified, its counter
 * is recorded in cache (`support_verification_consumed:{actorId}:{counter}`)
 * for `periodSeconds × (2·driftWindow + 1)` seconds, so the same code cannot
 * be re-used while it is still within the verifier's drift window.
 *
 * **Rate limiting:** verification attempts consume from the injected limiter
 * under the key `support_verification:{actorId}`. Successful verifies reward
 * the limiter.
 *
 * **Policy gating:** every operation runs through the
 * `'support.verification.allowed'` policy so applications can layer in an
 * org-wide kill switch or per-actor disablement.
 *
 * **Audit:** issuance, successful verification, and verification failures
 * are emitted via the injected {@link Logger} so a downstream sink can build
 * an audit trail.
 */
@Injectable()
export class SupportVerificationCodeService {
  constructor(
    private readonly options: SupportVerificationCodeServiceOptions,
    private readonly otpProvider: OtpProvider,
    private readonly secrets: SupportVerificationSecretRepository,
    private readonly encryptionProvider: EncryptionProvider,
    private readonly cache: CacheProvider,
    private readonly rateLimiter: RateLimiterCompatibleAbstract,
    private readonly policyService: PolicyService,
    private readonly logger: Logger,
  ) {}

  private getConsumedKey(actorId: string, counter: number) {
    return `support_verification_consumed:${actorId}:${counter}`;
  }

  private getRateLimitKey(actorId: string) {
    return `support_verification:${actorId}`;
  }

  private async assertPolicy(operation: 'issue' | 'verify', actor: TargetActor) {
    const result = await this.policyService.check('support.verification.allowed', { actor, operation });
    if (isPolicyResultDenied(result)) {
      throw httpError(403)
        .withDetails({ reason: result.reason })
        .withInternalDetails({
          message: `support.verification.allowed denied for actor ${actor.actorId}`,
          ...(result.details ?? {}),
        });
    }
  }

  private currentCounter(periodSeconds: number, at: DateTime = DateTime.utc()) {
    return Math.floor(at.toSeconds() / periodSeconds);
  }

  private async ensureSecret(actorId: string): Promise<SupportVerificationSecret> {
    const existing = await this.secrets.getSecret(actorId);
    if (existing) {
      return existing;
    }
    const secret = this.otpProvider.createSecret();
    const secretHash = this.encryptionProvider.encrypt(secret);
    return this.secrets.upsertSecret(actorId, { secretHash, options: this.options.defaults });
  }

  /**
   * Issue (or re-display) the current rotating support-verification code for
   * an actor.
   *
   * On first call for an actor a fresh OTP secret is generated and stored
   * encrypted; subsequent calls re-derive the current code from the same
   * secret. Calling repeatedly within the same period returns the same code;
   * calling across a period boundary returns the next code. Callers
   * typically display the code in the user's app alongside a countdown to
   * `expiresAt` so the user can read it over the phone to a support agent.
   *
   * @throws HTTP 403 when the `'support.verification.allowed'` policy denies.
   */
  async issueCode<K extends string = string>(actor: TargetActor<K>): Promise<SupportVerificationIssueResult> {
    await this.assertPolicy('issue', actor);

    const record = await this.ensureSecret(actor.actorId);
    const options = record.options as TotpOptions;
    const periodSeconds = options.periodSeconds ?? this.options.defaults.periodSeconds;

    const now = DateTime.utc();
    const counter = this.currentCounter(periodSeconds, now);
    const issuedAt = DateTime.fromSeconds(counter * periodSeconds).toUTC();
    const expiresAt = issuedAt.plus(Duration.fromObject({ seconds: periodSeconds }));

    const secret = this.encryptionProvider.decrypt(record.secretHash);
    const code = this.otpProvider.generate(secret, { ...options, timestamp: now });

    this.logger.info('support_verification.issued', { actorId: actor.actorId, counter, expiresAt: expiresAt.toISO() });

    return { code, periodSeconds, issuedAt, expiresAt };
  }

  /**
   * Verify a support-verification code an agent has entered on behalf of an
   * actor.
   *
   * Accepts codes within ±`driftWindow` periods of the current time
   * (default: ±1 period). Successfully verified codes are recorded so the
   * same code cannot be replayed while it is still within the verifier's
   * drift window. Rate-limited via the injected limiter keyed
   * `support_verification:{actorId}` so brute-force search across the
   * 6-digit space is bounded.
   *
   * @throws HTTP 403 when the `'support.verification.allowed'` policy denies.
   * @throws HTTP 404 when no secret has been issued for the actor.
   * @throws HTTP 429 when rate-limited.
   * @throws HTTP 401 (`WWW-Authenticate: Bearer error="invalid_code"`) when no in-window code matches, or the code has already been consumed.
   */
  async verifyCode<K extends string = string>(actor: TargetActor<K>, code: string): Promise<SupportVerificationVerifyResult> {
    await this.assertPolicy('verify', actor);

    const rateLimitKey = this.getRateLimitKey(actor.actorId);
    try {
      await this.rateLimiter.consume(rateLimitKey);
    } catch (error) {
      this.logger.warn('support_verification.rate_limited', { actorId: actor.actorId });
      throw httpError(429)
        .withInternalDetails({ message: `support verification rate-limited for actor: ${actor.actorId}` })
        .withCause(error as Error);
    }

    const record = await this.secrets.getSecret(actor.actorId);
    if (!record) {
      throw httpError(404).withDetails({ secret: 'not found' });
    }

    const options = record.options as TotpOptions;
    const periodSeconds = options.periodSeconds ?? this.options.defaults.periodSeconds;

    const secret = this.encryptionProvider.decrypt(record.secretHash);
    const now = DateTime.utc();
    const currentCounter = this.currentCounter(periodSeconds, now);

    let matchedCounter: number | undefined;
    for (let offset = 0; offset <= this.options.driftWindow; offset++) {
      for (const candidate of offset === 0 ? [currentCounter] : [currentCounter - offset, currentCounter + offset]) {
        const candidateAt = DateTime.fromSeconds(candidate * periodSeconds);
        const generated = this.otpProvider.generate(secret, { ...options, timestamp: candidateAt });
        if (generated.length === code.length && timingSafeEqual(generated, code)) {
          matchedCounter = candidate;
          break;
        }
      }
      if (matchedCounter !== undefined) break;
    }

    if (matchedCounter === undefined) {
      this.logger.warn('support_verification.failed', { actorId: actor.actorId });
      throw unauthorizedError('Bearer error="invalid_code"').withInternalDetails({
        message: `${actor.actorId} submitted invalid support verification code`,
      });
    }

    const consumedKey = this.getConsumedKey(actor.actorId, matchedCounter);
    const alreadyConsumed = await this.cache.get(consumedKey);
    if (alreadyConsumed) {
      this.logger.warn('support_verification.replay', { actorId: actor.actorId, counter: matchedCounter });
      throw unauthorizedError('Bearer error="invalid_code"').withInternalDetails({
        message: `${actor.actorId} replayed support verification code at counter ${matchedCounter}`,
      });
    }

    const ttlSeconds = periodSeconds * (2 * this.options.driftWindow + 1);
    await this.cache.set(consumedKey, '1', Duration.fromObject({ seconds: ttlSeconds }));
    await this.rateLimiter.reward(rateLimitKey);

    this.logger.info('support_verification.succeeded', { actorId: actor.actorId, counter: matchedCounter });

    return { actorId: actor.actorId, counter: matchedCounter, verifiedAt: now };
  }

  /**
   * Generate a fresh per-actor secret, invalidating any prior secret
   * immediately. Useful after a suspected disclosure (e.g. the user reports
   * a phishing attempt that revealed their code).
   */
  async rotateSecret(actorId: string): Promise<void> {
    const secret = this.otpProvider.createSecret();
    const secretHash = this.encryptionProvider.encrypt(secret);
    await this.secrets.upsertSecret(actorId, { secretHash, options: this.options.defaults });
    this.logger.info('support_verification.rotated', { actorId });
  }

  /**
   * Permanently revoke the actor's support-verification secret. Subsequent
   * `verifyCode` calls will throw HTTP 404 until {@link issueCode} is called
   * again.
   */
  async revoke(actorId: string): Promise<void> {
    await this.secrets.deleteSecret(actorId);
    this.logger.info('support_verification.revoked', { actorId });
  }

  /** Whether the actor has ever issued a support-verification code (i.e. has an active secret on file). */
  async hasSecret(actorId: string): Promise<boolean> {
    return (await this.secrets.getSecret(actorId)) !== undefined;
  }

  /** Clear the rate-limiter counter for an actor. Useful after a confirmed out-of-band identity verification. */
  async clearRateLimit(actorId: string): Promise<void> {
    await this.rateLimiter.delete(this.getRateLimitKey(actorId));
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
