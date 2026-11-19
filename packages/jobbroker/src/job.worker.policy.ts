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

  /**
   * The most jobs of one group (see {@link JobSendOptions.group}) that may run
   * at once, counted across every node consuming the queue. pg-boss tracks it
   * in the database. Jobs sent without a group are not limited by it.
   *
   * With a limit of 1, a group's jobs run one at a time across the whole fleet.
   * Workers that fetch at the same moment can briefly claim past the limit, but
   * pg-boss counts the group again once a claim commits and puts the extra jobs
   * back before any handler sees them. The exception is a queue created outside
   * the runner with a pg-boss policy that caps queued jobs per key (such as
   * `stately`): a job that policy will not take back runs over the limit.
   *
   * The count is shared, but the limit is still this worker's: each node checks
   * the database against the value it was started with, so give every node
   * consuming the queue the same value.
   *
   * Pass a number for one limit on every group, or `{ default, tiers }` to give
   * groups in particular tiers their own limit, with `default` covering the
   * rest. Cannot be combined with {@link localGroupConcurrency}: the runner
   * refuses to start a queue whose effective policy sets both.
   *
   * @example
   * ```typescript
   * // Up to two of a tenant's jobs at a time across the fleet.
   * const worker: JobWorkerPolicy = { concurrency: 8, groupConcurrency: 2 };
   * ```
   */
  groupConcurrency?: number | { default: number; tiers?: Record<string, number> };

  /**
   * The most jobs of one group (see {@link JobSendOptions.group}) that may run
   * at once on this node. The runner's workers for the queue share an
   * in-process count, so the limit is exact within the node: with a limit of 1,
   * a group's jobs run strictly one at a time while {@link concurrency} still
   * lets different groups run side by side. Jobs sent without a group are not
   * limited by it.
   *
   * It does not coordinate across nodes. Two nodes consuming the same queue can
   * each run one of a group's jobs at the same time, so it fits a queue that a
   * single node consumes, or a cap on what one node takes on per group. For a
   * limit that spans nodes, use {@link groupConcurrency}.
   *
   * Takes the same shapes as {@link groupConcurrency}: a number, or
   * `{ default, tiers }`. Cannot be combined with {@link groupConcurrency}: the
   * runner refuses to start a queue whose effective policy sets both.
   *
   * @example
   * ```typescript
   * // Three jobs at once on this node, but never two from the same group.
   * const worker: JobWorkerPolicy = { concurrency: 3, localGroupConcurrency: 1 };
   * ```
   */
  localGroupConcurrency?: number | { default: number; tiers?: Record<string, number> };
}
