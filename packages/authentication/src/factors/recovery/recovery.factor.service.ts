import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';
import { RateLimiterCompatibleAbstract } from 'rate-limiter-flexible';
import { PasswordHashProvider } from '../../providers/password.hash.provider.js';
import { RecoveryCodeFactor, RecoveryCodeFactorRepository, RecoveryCodeValue } from './recovery.factor.repository.js';

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Configuration options for {@link RecoveryFactorService}.
 */
@Injectable()
export class RecoveryFactorServiceOptions {
  constructor(
    /** How many recovery codes to issue per batch. */
    public readonly codeCount: number = 10,
    /**
     * Number of random bytes underlying each code (encoded as Crockford base32
     * in groups of five characters). 10 bytes → 16 base32 characters → ~50 bits
     * of entropy after the dash separators are stripped.
     */
    public readonly codeBytes: number = 10,
  ) {}
}

/**
 * Manages recovery codes: pre-generated, single-use backup credentials an actor
 * can fall back to when their primary or secondary factors are unavailable.
 *
 * Codes are hashed with the bundled {@link PasswordHashProvider} (Argon2id by
 * default), so a database dump does not yield plaintext codes. The plaintext is
 * returned exactly once — at {@link generateRecoveryCodes} time — and is never
 * reachable thereafter.
 *
 * Verification is rate-limited via the injected
 * {@link RateLimiterCompatibleAbstract} keyed `recovery:{actorId}` so brute-force
 * attempts against a known actor are bounded.
 */
@Injectable()
export class RecoveryFactorService {
  constructor(
    private readonly options: RecoveryFactorServiceOptions,
    private readonly recoveryFactorRepository: RecoveryCodeFactorRepository,
    private readonly passwordHashProvider: PasswordHashProvider,
    private readonly rateLimiter: RateLimiterCompatibleAbstract,
  ) {}

  private encodeCrockford(bytes: Buffer): string {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        output += CROCKFORD_ALPHABET[(value >>> bits) & 0x1f];
      }
    }
    if (bits > 0) {
      output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
    }
    return output;
  }

  private formatCode(raw: string): string {
    const groups: string[] = [];
    for (let i = 0; i < raw.length; i += 5) {
      groups.push(raw.slice(i, i + 5));
    }
    return groups.join('-');
  }

  private normalizeCode(code: string): string {
    return code.replace(/[\s-]/g, '').toUpperCase();
  }

  private generateCode(): string {
    const bytes = crypto.randomBytes(this.options.codeBytes);
    return this.formatCode(this.encodeCrockford(bytes));
  }

  /**
   * Generate a fresh batch of recovery codes for an actor.
   *
   * Any prior batch is replaced atomically — codes from earlier batches stop
   * being accepted before the new batch is verifiable. The plaintext codes
   * are returned **only once** in the response; persistence is hashed.
   *
   * @returns `{ codes, batchId, generatedAt }` — show `codes` to the user
   *   (typically as a download or copyable list); they cannot be recovered later.
   */
  async generateRecoveryCodes(actorId: string): Promise<{ codes: string[]; batchId: string; generatedAt: DateTime }> {
    const batchId = crypto.randomBytes(16).toString('base64url');
    const codes: string[] = [];
    const values: { value: RecoveryCodeValue; batchId: string }[] = [];

    for (let i = 0; i < this.options.codeCount; i++) {
      const code = this.generateCode();
      const { hash, salt } = await this.passwordHashProvider.hash(this.normalizeCode(code));
      codes.push(code);
      values.push({ value: { hash, salt }, batchId });
    }

    await this.recoveryFactorRepository.replaceAll(actorId, values);

    return { codes, batchId, generatedAt: DateTime.utc() };
  }

  /**
   * Replace the actor's recovery codes with a fresh batch. Alias for
   * {@link generateRecoveryCodes} that exists to make caller intent explicit
   * when invalidating an existing set (e.g. after a code has been used).
   */
  async regenerateRecoveryCodes(actorId: string) {
    return this.generateRecoveryCodes(actorId);
  }

  /**
   * Verify a recovery code submitted by an actor and consume it on success.
   *
   * Rate-limited via the injected limiter under the key `recovery:{actorId}`.
   * Iterates the actor's active codes and verifies the submitted code against
   * each hash; on a match the code is marked used and the consumed factor is
   * returned. Codes are single-use — a verified code is never accepted again.
   *
   * @throws HTTP 429 when rate-limited.
   * @throws HTTP 401 (`WWW-Authenticate: Bearer error="invalid_credentials"`) when no active code matches.
   */
  async verifyRecoveryCode(actorId: string, code: string): Promise<RecoveryCodeFactor> {
    const key = `recovery:${actorId}`;
    try {
      await this.rateLimiter.consume(key);
    } catch (error) {
      throw httpError(429)
        .withInternalDetails({ message: `recovery code verification has been rate limited for actor: ${actorId}` })
        .withCause(error as Error);
    }

    const normalized = this.normalizeCode(code);
    const activeCodes = await this.recoveryFactorRepository.listFactors(actorId, true);

    for (const factor of activeCodes) {
      if (await this.passwordHashProvider.verify(normalized, factor.value.hash, factor.value.salt)) {
        const consumed = await this.recoveryFactorRepository.markUsed(actorId, factor.id);
        await this.rateLimiter.reward(key);
        return consumed;
      }
    }

    throw unauthorizedError('Bearer error="invalid_credentials"').withInternalDetails({
      message: `${actorId} submitted invalid recovery code`,
    });
  }

  /** Count active (unused) recovery codes on file for an actor. */
  async countRemainingCodes(actorId: string) {
    return this.recoveryFactorRepository.countActive(actorId);
  }

  /** Clear the rate limiter counter for an actor. Useful after a successful out-of-band recovery. */
  async clearRateLimit(actorId: string) {
    await this.rateLimiter.delete(`recovery:${actorId}`);
  }

  /** List recovery code factors for an actor. Pass `active` to filter by activation state. */
  async listFactors(actorId: string, active?: boolean) {
    return this.recoveryFactorRepository.listFactors(actorId, active);
  }
}
