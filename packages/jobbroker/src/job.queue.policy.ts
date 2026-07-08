import { Duration } from 'luxon';

/**
 * Backend-agnostic reliability policy for a job *queue*: how many times a failed
 * job is retried, how long to wait between attempts, how long a running job may
 * take before it is considered stuck, and where a job goes once it has exhausted
 * its retries.
 *
 * Like {@link JobSendOptions}, this type describes *intent* rather than any one
 * backend's wire format. Retry, backoff, and dead-lettering are queue-level
 * concepts on every mainstream queue (pg-boss `retryLimit`/`deadLetter`, SQS's
 * redrive policy `maxReceiveCount` + DLQ ARN, Cloud Tasks' `maxAttempts` /
 * `minBackoff`), so a policy declared here maps cleanly onto whichever backend
 * is in use. A backend that cannot honor a requested knob throws a
 * `NotSupportedError` rather than silently ignoring it.
 *
 * Because these are queue-level properties, the policy is declared where the job
 * is registered (see the pg-boss `PgBossJobRegistration`), not per individual
 * `send`. Deferring a single job is still a per-send concern (see
 * {@link JobSendOptions.startAfter}); retry/dead-letter behavior is not.
 *
 * @example
 * ```typescript
 * const policy: JobQueuePolicy = {
 *   retryLimit: 5,
 *   retryDelay: Duration.fromObject({ seconds: 30 }),
 *   retryBackoff: true,
 *   deadLetter: 'charge.webhook.dead',
 * };
 * ```
 */
export interface JobQueuePolicy {
  /**
   * How many times a failed job is retried before it is marked failed (and, if a
   * {@link deadLetter} queue is set, dead-lettered). Omit to use the backend's
   * default.
   */
  retryLimit?: number;

  /**
   * Delay to wait before retrying a failed job. When {@link retryBackoff} is
   * enabled this is the *base* delay that the backoff curve grows from. Backends
   * that measure retry delay in whole seconds receive this rounded to the
   * nearest second.
   */
  retryDelay?: Duration;

  /**
   * Grow the delay between successive retries exponentially (with jitter)
   * starting from {@link retryDelay}, instead of waiting a fixed
   * {@link retryDelay} each time. Useful for backing off transient failures such
   * as a rate-limited external API.
   */
  retryBackoff?: boolean;

  /**
   * Upper bound on the delay between retries when {@link retryBackoff} is
   * enabled. Ignored for fixed-delay retries. Rounded to whole seconds for
   * backends that require it.
   */
  retryDelayMax?: Duration;

  /**
   * How long a job may run before it is considered stuck and made eligible for
   * retry (or failure). Maps onto pg-boss `expireInSeconds`, an SQS visibility
   * timeout, and similar. Rounded to whole seconds for backends that require it.
   */
  expiresIn?: Duration;

  /**
   * Name of the dead-letter queue that receives a job once it has exhausted all
   * of its retries, so terminal failures are preserved for inspection or replay
   * instead of being dropped. The referenced queue must exist; backends that can
   * do so (pg-boss) create it automatically when absent.
   */
  deadLetter?: string;
}
