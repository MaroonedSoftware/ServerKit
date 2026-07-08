import { Injectable } from 'injectkit';
import { JobInfo } from './job.info.js';

/**
 * A backend-agnostic snapshot of a single queue's depth and health, as returned
 * by {@link JobMonitor.getQueueStats}. Every count is a point-in-time reading;
 * poll it on a schedule (for example from a reconciliation job) to drive
 * alerting on a backlog or a growing dead-letter queue.
 *
 * The counts are the lowest common denominator every supported backend can
 * report. `failed` in particular is a *retained* count: it reflects failures
 * still held in the queue subject to the queue's retention policy, not an
 * all-time total.
 */
export interface JobQueueStats {
  /** The queue name these stats describe. */
  name: string;
  /** Jobs waiting to be processed (enqueued but not yet active). */
  queued: number;
  /** Jobs currently being executed by a worker. */
  active: number;
  /** Failed jobs still retained in the queue (bounded by the retention policy). */
  failed: number;
  /** All jobs still retained for the queue across every state. */
  total: number;
}

/**
 * Filters for {@link JobMonitor.listJobs}. All fields are optional; omitting them
 * lists every job currently retained in the queue (the common case when
 * inspecting a small dead-letter queue).
 */
export interface JobQueryOptions {
  /** Match a single job by its id. */
  id?: string;
  /** Match jobs whose payload contains these fields (a partial-match filter). */
  data?: Record<string, unknown>;
  /** Restrict the result to jobs still waiting to be processed. */
  queuedOnly?: boolean;
}

/**
 * Options for {@link JobMonitor.redrive}, which moves dead-lettered jobs out of a
 * queue and back into circulation.
 */
export interface JobRedriveOptions {
  /**
   * The queue to move jobs into. When omitted, each job returns to the queue it
   * originally came from before it was dead-lettered — the usual "reprocess"
   * behavior. Supply this to funnel everything into a specific queue instead.
   */
  destination?: string;
  /**
   * Only redrive jobs that originated from this source queue. Useful when a
   * single dead-letter queue collects failures from several source queues and
   * you want to drain just one source's worth.
   */
  sourceName?: string;
  /**
   * Maximum number of jobs to move in this call, oldest first. Call repeatedly
   * (or on a schedule) to drain a large dead-letter queue at a controlled rate.
   */
  limit?: number;
}

/**
 * Read-and-remediate interface for job queues, and in particular for
 * *dead-letter queues*: the queues that collect jobs which have exhausted their
 * retries (see the queue policy on the pg-boss backend's registration).
 *
 * Where {@link JobBroker} is the producer side (enqueue, cancel, inspect a job
 * you hold the id for) and {@link JobRunner} is the consumer side, `JobMonitor`
 * is the operator side: it lets a consumer answer "how deep is this queue?",
 * "what is stuck in this dead-letter queue?", and "reprocess / discard those
 * jobs". Unlike the broker, it operates on raw queue names and does **not**
 * require the queue to be registered, because a dead-letter queue is often an
 * unregistered sink with no worker of its own.
 *
 * Backends that cannot honor an operation throw a `NotSupportedError` rather than
 * silently doing nothing, matching the rest of the package. The bundled pg-boss
 * backend supports every operation.
 *
 * @example
 * ```typescript
 * // A reconciliation sweep over a money-critical dead-letter queue.
 * const stats = await monitor.getQueueStats('charge.webhook.dead');
 * if (stats && stats.total > 0) {
 *   const stuck = await monitor.listJobs('charge.webhook.dead'); // inspect / log / alert
 *   const moved = await monitor.redrive('charge.webhook.dead', { limit: 100 }); // drain back
 * }
 * ```
 */
@Injectable()
export abstract class JobMonitor {
  /**
   * Reports the current depth and health of a queue.
   *
   * @param name - The queue name to inspect (may be an unregistered dead-letter queue).
   * @returns A promise resolving to the {@link JobQueueStats}, or `null` if no
   *          queue with that name exists.
   * @throws `NotSupportedError` if the backend cannot report queue statistics.
   */
  abstract getQueueStats(name: string): Promise<JobQueueStats | null>;

  /**
   * Lists the jobs currently retained in a queue, optionally filtered.
   *
   * The primary use is inspecting a dead-letter queue: the returned
   * {@link JobInfo} objects expose each poison message's id, state, and original
   * payload so a consumer can decide whether to reprocess ({@link redrive}),
   * discard ({@link deleteJob}), or escalate it.
   *
   * @typeParam Payload - The type of the job payloads.
   * @param name - The queue name to list (may be an unregistered dead-letter queue).
   * @param options - Optional {@link JobQueryOptions} filters.
   * @returns A promise resolving to the matching jobs (empty if none / no such queue).
   * @throws `NotSupportedError` if the backend cannot enumerate jobs.
   */
  abstract listJobs<Payload extends object>(name: string, options?: JobQueryOptions): Promise<JobInfo<Payload>[]>;

  /**
   * Moves dead-lettered jobs out of a queue and back into circulation, returning
   * the number of jobs moved.
   *
   * By default each job goes back to the source queue it was dead-lettered from,
   * so a worker can process it again; pass {@link JobRedriveOptions.destination}
   * to route them elsewhere, {@link JobRedriveOptions.sourceName} to drain only
   * one source's jobs from a shared dead-letter queue, and
   * {@link JobRedriveOptions.limit} to move at a controlled rate.
   *
   * @param name - The (dead-letter) queue to drain.
   * @param options - Optional {@link JobRedriveOptions}.
   * @returns A promise resolving to the count of jobs moved.
   * @throws `NotSupportedError` if the backend cannot redrive jobs.
   */
  abstract redrive(name: string, options?: JobRedriveOptions): Promise<number>;

  /**
   * Permanently deletes one or more jobs from a queue.
   *
   * This is the "discard" action for a dead-letter queue: a poison message that
   * should not be reprocessed is removed outright. Unlike {@link JobBroker.deleteJob},
   * it does not require the queue to be registered.
   *
   * @param name - The queue name the jobs live in.
   * @param id - A single job id, or an array of ids, to delete.
   * @returns A promise that resolves once the jobs have been deleted.
   * @throws `NotSupportedError` if the backend cannot delete jobs.
   */
  abstract deleteJob(name: string, id: string | string[]): Promise<void>;

  /**
   * Re-attempts one or more failed jobs *in place*, re-queuing them within their
   * current queue.
   *
   * Use this to re-run a job that failed in a queue that has its own worker. To
   * reprocess a job sitting in a dead-letter *sink* (a queue with no worker),
   * prefer {@link redrive}, which moves it back to a queue that can run it.
   *
   * @param name - The queue name the jobs live in.
   * @param id - A single job id, or an array of ids, to retry.
   * @returns A promise that resolves once the jobs have been re-queued.
   * @throws `NotSupportedError` if the backend cannot retry jobs.
   */
  abstract retryJob(name: string, id: string | string[]): Promise<void>;
}
