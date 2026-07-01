import { PgBoss } from 'pg-boss';
import { Injectable } from 'injectkit';
import { JobBroker } from '../job.broker.js';
import { JobInfo } from '../job.info.js';
import { PgBossJobRegistryMap } from './pgboss.job.registration.js';
import { PgBossConnectionProvider } from './pgboss.connection.provider.js';

/**
 * PgBoss implementation of the {@link JobBroker} interface.
 *
 * This broker uses PostgreSQL (via pg-boss) as the backing queue for job
 * processing. It provides reliable, transactional job queuing with support
 * for scheduled jobs using cron expressions.
 *
 * Each enqueue and schedule call sources its pg-boss `db` executor from the
 * injected {@link PgBossConnectionProvider}. The default provider returns
 * `undefined` (pg-boss uses its own pool), but a request-scoped override can
 * supply a transaction-bound executor so jobs are enqueued atomically with the
 * surrounding database transaction.
 *
 * @example
 * ```typescript
 * // Setup with dependency injection
 * const pgboss = new PgBoss('postgres://...');
 * const registry = new PgBossJobRegistryMap();
 * registry.set('send-email', SendEmailJob);
 *
 * const broker = new PgBossJobBroker(registry, pgboss, new PgBossConnectionProvider());
 *
 * // Send a job
 * await broker.send('send-email', {
 *   to: 'user@example.com',
 *   subject: 'Hello!'
 * });
 * ```
 */
@Injectable()
export class PgBossJobBroker extends JobBroker {
  /**
   * Creates a new PgBossJobBroker instance.
   *
   * @param registrations - The registry map containing all registered jobs.
   * @param pgboss - The pg-boss instance to use for queue operations.
   * @param connectionProvider - Supplies the pg-boss `db` executor for each
   *        enqueue/schedule; the default returns `undefined` (pg-boss's own
   *        pool), while a request-scoped override enables transactional enqueue.
   */
  constructor(
    private readonly registrations: PgBossJobRegistryMap,
    private readonly pgboss: PgBoss,
    private readonly connectionProvider: PgBossConnectionProvider,
  ) {
    super();
  }

  /**
   * Sends a job to the PgBoss queue for immediate processing.
   *
   * The job-insert SQL runs against the executor returned by the injected
   * {@link PgBossConnectionProvider}; when that executor is bound to an active
   * transaction, the job is enqueued atomically with that transaction.
   *
   * @typeParam Payload - The type of the job payload.
   * @param name - The name of the registered job to execute.
   * @param payload - The data to pass to the job handler.
   * @returns A promise that resolves with the id of the queued job.
   * @throws Error if the job name is not found in the registry.
   * @throws Error if pg-boss does not return a job id (e.g. the job was
   *         deduplicated away by a singleton policy).
   */
  async send<Payload extends object>(name: string, payload: Payload): Promise<string> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    const id = await this.pgboss.send(name, payload, { db: this.connectionProvider.executor() });
    if (!id) {
      throw new Error(`Failed to enqueue job ${name}`);
    }

    return id;
  }

  /**
   * Schedules a recurring job using a cron expression.
   *
   * The job will be automatically enqueued by pg-boss according to the
   * specified cron schedule. If a schedule already exists for this job,
   * it will be updated with the new cron expression and payload.
   *
   * The schedule-insert SQL runs against the executor returned by the injected
   * {@link PgBossConnectionProvider}; the default executor uses pg-boss's own
   * pool, which is the expected behavior for bootstrap-time scheduling.
   *
   * @typeParam Payload - The type of the job payload.
   * @param name - The name of the registered job to schedule.
   * @param cron - A cron expression (e.g., '0 9 * * *' for daily at 9am).
   * @param payload - Optional data to pass to the job on each execution.
   * @returns A promise that resolves when the schedule has been created.
   * @throws Error if the job name is not found in the registry.
   */
  async schedule<Payload extends object>(name: string, cron: string, payload?: Payload): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.schedule(name, cron, payload, { db: this.connectionProvider.executor() });
  }

  /**
   * Removes a scheduled job from pg-boss.
   *
   * This stops future executions of the scheduled job. Jobs that are
   * already queued will still be processed.
   *
   * @param name - The name of the scheduled job to remove.
   * @returns A promise that resolves when the schedule has been removed.
   * @throws Error if the job name is not found in the registry.
   */
  async unschedule(name: string): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.unschedule(name);
  }

  /**
   * Cancels one or more jobs in the PgBoss queue.
   *
   * pg-boss marks the job(s) as `cancelled` in PostgreSQL. This works whether a
   * job is still queued or already running: a queued job is never picked up,
   * while a running job is observed as cancelled by the {@link PgBossJobRunner}
   * (which polls for the state change and aborts the handler's `AbortSignal`).
   * Interrupting a running handler is cooperative — see {@link Job.run}.
   *
   * @param name - The name of the registered job to cancel.
   * @param id - A single job id, or an array of ids, to cancel.
   * @returns A promise that resolves once the cancellation has been requested.
   * @throws Error if the job name is not found in the registry.
   */
  async cancel(name: string, id: string | string[]): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.cancel(name, id, { db: this.connectionProvider.executor() });
  }

  /**
   * Resumes one or more previously cancelled jobs, re-queuing them for processing.
   *
   * Only jobs currently in the `cancelled` state are affected.
   *
   * @param name - The name of the registered job to resume.
   * @param id - A single job id, or an array of ids, to resume.
   * @returns A promise that resolves once the jobs have been re-queued.
   * @throws Error if the job name is not found in the registry.
   */
  async resume(name: string, id: string | string[]): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.resume(name, id, { db: this.connectionProvider.executor() });
  }

  /**
   * Permanently deletes one or more jobs from the PgBoss queue.
   *
   * @param name - The name of the registered job to delete.
   * @param id - A single job id, or an array of ids, to delete.
   * @returns A promise that resolves once the jobs have been deleted.
   * @throws Error if the job name is not found in the registry.
   */
  async deleteJob(name: string, id: string | string[]): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.deleteJob(name, id, { db: this.connectionProvider.executor() });
  }

  /**
   * Looks up the current state of a single job.
   *
   * @typeParam Payload - The type of the job payload.
   * @param name - The name of the registered job to look up.
   * @param id - The id of the job to look up.
   * @returns A promise that resolves with the {@link JobInfo} for the job, or
   *          `null` if no job with that id exists.
   * @throws Error if the job name is not found in the registry.
   */
  async getJob<Payload extends object>(name: string, id: string): Promise<JobInfo<Payload> | null> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    const [job] = await this.pgboss.findJobs<Payload>(name, { id, db: this.connectionProvider.executor() });
    if (!job) {
      return null;
    }

    return { id: job.id, name: job.name, state: job.state, data: job.data };
  }
}
