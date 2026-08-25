import { Identifier, Injectable } from 'injectkit';
import { Job } from '../job.js';
import { JobQueuePolicy } from '../job.queue.policy.js';
import { JobWorkerPolicy } from '../job.worker.policy.js';

/**
 * Configuration object for a job registration.
 *
 * Use the object form (rather than a bare job identifier) when you need to
 * attach a cron schedule, a per-queue {@link JobQueuePolicy}, a per-queue
 * {@link JobWorkerPolicy}, or any combination of them. Every field beyond `job`
 * is optional, so this shape covers:
 *
 * - `{ job }` — an on-demand job (equivalent to registering the bare identifier).
 * - `{ job, cron }` — a job that also runs on a schedule.
 * - `{ job, policy }` — retry and dead-letter behavior declared where the job is
 *   mapped.
 * - `{ job, worker }` — how much concurrency this node gives the job's queue.
 *
 * The two policies are independent and answer different questions: `policy` is
 * stored on the queue and governs what happens to a job that fails, `worker`
 * configures the worker this process starts and governs how fast jobs are taken
 * off the queue.
 *
 * @example
 * ```typescript
 * // Scheduled job
 * const scheduledJob: PgBossJobRegistration = {
 *   job: DailyReportJob,
 *   cron: '0 9 * * *', // Every day at 9 AM
 * };
 *
 * // On-demand job with a retry / dead-letter policy
 * const webhookJob: PgBossJobRegistration = {
 *   job: DeliverWebhookJob,
 *   policy: {
 *     retryLimit: 5,
 *     retryDelay: Duration.fromObject({ seconds: 30 }),
 *     retryBackoff: true,
 *     deadLetter: 'deliver.webhook.dead',
 *   },
 *   worker: { concurrency: 8 },
 * };
 * ```
 */
export type PgBossJobRegistration = {
  /** The job class identifier to instantiate when the job runs. */
  job: Identifier<Job>;
  /** An optional cron expression defining when the job should run. */
  cron?: string;
  /**
   * An optional per-queue retry and dead-letter policy applied to this job's
   * queue when the runner starts. See {@link JobQueuePolicy}.
   */
  policy?: JobQueuePolicy;
  /**
   * An optional per-queue worker policy — concurrency, batch size, and poll
   * interval — applied when this node starts a worker for the job's queue. It
   * configures this process only, not the queue. See {@link JobWorkerPolicy}.
   */
  worker?: JobWorkerPolicy;
};

/**
 * Registry map for PgBoss job registrations.
 *
 * This map holds all job registrations, mapping job names to either:
 * - A bare job class identifier (for a plain on-demand job)
 * - A {@link PgBossJobRegistration} object, which adds an optional cron schedule,
 *   an optional per-queue {@link JobQueuePolicy}, and/or an optional per-queue
 *   {@link JobWorkerPolicy}
 *
 * The registry is used by both {@link PgBossJobBroker} and {@link PgBossJobRunner}
 * to validate job names and resolve job handlers.
 *
 * @example
 * ```typescript
 * const registry = new PgBossJobRegistryMap();
 *
 * // Register an on-demand job
 * registry.set('send-email', SendEmailJob);
 *
 * // Register a scheduled job
 * registry.set('daily-cleanup', {
 *   job: CleanupJob,
 *   cron: '0 0 * * *'
 * });
 *
 * // Register an on-demand job with a retry / dead-letter policy
 * registry.set('deliver-webhook', {
 *   job: DeliverWebhookJob,
 *   policy: { retryLimit: 5, deadLetter: 'deliver-webhook-dead' }
 * });
 *
 * // Register a hot queue that this node runs eight at a time
 * registry.set('image.thumbnail', {
 *   job: ThumbnailJob,
 *   worker: { concurrency: 8 }
 * });
 *
 * // Use with dependency injection
 * container.bind(PgBossJobRegistryMap).toValue(registry);
 * ```
 */
@Injectable()
export class PgBossJobRegistryMap extends Map<string, Identifier<Job> | PgBossJobRegistration> {}
