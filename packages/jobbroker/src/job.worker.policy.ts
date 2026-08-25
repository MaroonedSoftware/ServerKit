import { Duration } from 'luxon';

/**
 * Backend-agnostic throughput policy for a job *worker*: how many jobs a single
 * node may run at once for a queue, how many it fetches per trip to the backend,
 * and how long it waits between fetches when the queue is idle.
 *
 * Like {@link JobQueuePolicy}, this describes *intent* rather than any one
 * backend's wire format. Worker concurrency, batching, and poll interval are
 * consumer-side concepts on every mainstream queue (pg-boss
 * `localConcurrency`/`batchSize`/`pollingIntervalSeconds`, BullMQ's worker
 * `concurrency`, an SQS consumer's concurrency plus `MaxNumberOfMessages` and
 * wait time), so a policy declared here maps cleanly onto whichever backend is
 * in use. A backend that cannot honor a requested knob throws a
 * `NotSupportedError` rather than silently ignoring it.
 *
 * Unlike {@link JobQueuePolicy}, none of this is stored on the queue: it
 * configures the worker this process starts, so two nodes consuming the same
 * queue may legitimately use different values, and changing one takes effect on
 * the next runner start rather than for everyone at once.
 *
 * @example
 * ```typescript
 * const worker: JobWorkerPolicy = {
 *   concurrency: 8,
 *   pollInterval: Duration.fromObject({ seconds: 1 }),
 * };
 * ```
 */
export interface JobWorkerPolicy {
  /**
   * How many jobs this node may run at once for the queue. Each unit of
   * concurrency is an independent worker that fetches and settles its own job,
   * so one job's failure has no effect on its siblings. Omit to use the
   * backend's default (a single worker, on pg-boss).
   *
   * This is the knob to reach for when a queue is falling behind. See
   * {@link batchSize} for why the other one usually is not.
   */
  concurrency?: number;

  /**
   * How many jobs a single worker fetches per trip to the backend, handed to the
   * handler together as one batch. Omit to use the backend's default (one job
   * per fetch, on pg-boss).
   *
   * Prefer {@link concurrency} for throughput. Backends that settle a batch as a
   * unit — pg-boss does — will retry every job in a batch when any one of them
   * fails, so raising this trades failure isolation for fewer round trips. Raise
   * it only when the work is genuinely batch-shaped.
   */
  batchSize?: number;

  /**
   * How long a worker waits between fetches while the queue is idle. Lower it to
   * cut the latency between a job being sent and being picked up; raise it to
   * cut idle load on the backend. Backends that measure this in seconds receive
   * it as a fractional second count, not rounded.
   */
  pollInterval?: Duration;
}
