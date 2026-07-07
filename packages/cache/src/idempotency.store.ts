import { Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { CacheProvider } from './cache.provider.js';

/**
 * Outcome of an {@link IdempotencyStore.deduplicate} call.
 *
 * - `processed` — this call owned the key and ran `work`; `result` is its return value.
 * - `duplicate` — the key was already claimed (in-flight, completed, or dead-lettered);
 *   `work` was NOT run. The caller should still ack success so the source stops redelivering.
 * - `dropped` — `work` has now failed `maxAttempts` times; the event is dead-lettered and
 *   will be treated as a `duplicate` on any future redelivery. `work` will not run again.
 *   The caller should ack success (stop the retry storm) and surface `dropped` for alerting.
 */
export type IdempotencyOutcome<T> =
  | { status: 'processed'; result: T }
  | { status: 'duplicate' }
  | { status: 'dropped'; attempts: number };

/**
 * Per-call tuning for {@link IdempotencyStore.deduplicate}.
 */
export interface IdempotencyOptions {
  /**
   * How long the in-flight claim lives while `work` runs. A redelivery arriving within this
   * window is treated as a `duplicate`. Must comfortably exceed the slowest expected `work`
   * duration; if `work` outlives it a concurrent redelivery can re-claim and double-process.
   * @default 5 minutes
   */
  inFlightTtl?: Duration;
  /**
   * How long the completed/dead marker is retained after `work` settles. Size this to at least
   * the source platform's redelivery window (e.g. Slack ~1h, WhatsApp/Telegram hours).
   * @default 24 hours
   */
  retentionTtl?: Duration;
  /**
   * Maximum number of times `work` may fail for a given key before the event is dead-lettered
   * (subsequent calls return `dropped` without running `work`). Prevents a poison event from
   * being reprocessed forever by an at-least-once source.
   * @default 5
   */
  maxAttempts?: number;
}

const STATE_INFLIGHT = 'inflight';
const STATE_COMPLETED = 'completed';
const STATE_DEAD = 'dead';

const DEFAULT_IN_FLIGHT_TTL = Duration.fromObject({ minutes: 5 });
const DEFAULT_RETENTION_TTL = Duration.fromObject({ hours: 24 });
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * De-duplicates at-least-once deliveries (webhooks, queue messages, retried commands) keyed by
 * a caller-supplied stable id. Wrap the side-effecting work in {@link deduplicate}: the first
 * caller for a key runs it, concurrent/subsequent callers for the same key are told it is a
 * `duplicate`, and an event that keeps failing is eventually dead-lettered.
 *
 * This is an abstract token so it can be bound in DI and swapped for alternative backends;
 * {@link CacheIdempotencyStore} is the default {@link CacheProvider}-backed implementation.
 *
 * @example
 * ```typescript
 * container.bind(IdempotencyStore).to(CacheIdempotencyStore);
 * ```
 */
@Injectable()
export abstract class IdempotencyStore {
  /**
   * Runs `work` at most once per `key`, coordinating across processes via the backing store.
   *
   * @param key     - Stable, source-provided id for the event (e.g. `slack:event:{event_id}`).
   *   Include a tenant/bot scope where the raw id is not globally unique.
   * @param work    - The side-effecting work to run exactly once for this key.
   * @param options - Optional {@link IdempotencyOptions} TTL/attempt overrides.
   * @returns An {@link IdempotencyOutcome}: `processed` (ran, with result), `duplicate` (skipped),
   *   or `dropped` (dead-lettered after repeated failures).
   */
  abstract deduplicate<T>(key: string, work: () => Promise<T>, options?: IdempotencyOptions): Promise<IdempotencyOutcome<T>>;
}

/**
 * {@link CacheProvider}-backed {@link IdempotencyStore}. Uses the provider's atomic
 * {@link CacheProvider.add} (set-if-absent) as the claim primitive, so concurrent callers race
 * and exactly one wins. Keys are namespaced under `idempotency:` and a per-key attempt counter
 * (`…:attempts`) survives claim releases so the poison-event cap is enforced across redeliveries.
 *
 * Semantics on failure: when `work` throws, the claim is released so the source's next redelivery
 * legitimately reprocesses — until the failure count reaches `maxAttempts`, at which point the key
 * is dead-lettered (`dropped`) and no longer reprocessed.
 */
@Injectable({ deps: [CacheProvider] })
export class CacheIdempotencyStore extends IdempotencyStore {
  constructor(private readonly cache: CacheProvider) {
    super();
  }

  async deduplicate<T>(key: string, work: () => Promise<T>, options: IdempotencyOptions = {}): Promise<IdempotencyOutcome<T>> {
    const inFlightTtl = options.inFlightTtl ?? DEFAULT_IN_FLIGHT_TTL;
    const retentionTtl = options.retentionTtl ?? DEFAULT_RETENTION_TTL;
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    const stateKey = this.stateKey(key);

    // Atomically claim the key. If another caller already holds it (in-flight, completed, or
    // dead), this delivery is a duplicate and `work` must not run.
    const claimed = await this.cache.add(stateKey, STATE_INFLIGHT, { ttl: inFlightTtl });
    if (!claimed) {
      return { status: 'duplicate' };
    }

    try {
      const result = await work();
      // Assert the completed marker with `set` (not `update`) so it lands even if the in-flight
      // claim expired while `work` ran.
      await this.cache.set(stateKey, STATE_COMPLETED, retentionTtl);
      await this.cache.delete(this.attemptsKey(key));
      return { status: 'processed', result };
    } catch (error) {
      const attempts = await this.recordFailure(key, retentionTtl);
      if (attempts >= maxAttempts) {
        // Poison event: dead-letter it so future redeliveries are dropped rather than reprocessed.
        await this.cache.set(stateKey, STATE_DEAD, retentionTtl);
        return { status: 'dropped', attempts };
      }
      // Release the claim so the source's next redelivery can retry the work.
      await this.cache.delete(stateKey);
      throw error;
    }
  }

  private async recordFailure(key: string, ttl: Duration): Promise<number> {
    const attemptsKey = this.attemptsKey(key);
    const current = Number((await this.cache.get(attemptsKey)) ?? '0');
    const next = Number.isFinite(current) ? current + 1 : 1;
    await this.cache.set(attemptsKey, String(next), ttl);
    return next;
  }

  private stateKey(key: string): string {
    return `idempotency:${key}`;
  }

  private attemptsKey(key: string): string {
    return `idempotency:${key}:attempts`;
  }
}
