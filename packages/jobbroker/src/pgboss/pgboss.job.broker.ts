import { PgBoss } from 'pg-boss';
import { Injectable } from 'injectkit';
import { JobBroker } from '../job.broker.js';
import { PgBossJobRegistryMap } from './pgboss.job.registeration.js';

/**
 * PgBoss implementation of the {@link JobBroker} interface.
 *
 * This broker uses PostgreSQL (via pg-boss) as the backing queue for job
 * processing. It provides reliable, transactional job queuing with support
 * for scheduled jobs using cron expressions.
 *
 * @example
 * ```typescript
 * // Setup with dependency injection
 * const pgboss = new PgBoss('postgres://...');
 * const registry = new PgBossJobRegistryMap();
 * registry.set('send-email', SendEmailJob);
 *
 * const broker = new PgBossJobBroker(registry, pgboss);
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
   */
  constructor(
    private readonly registrations: PgBossJobRegistryMap,
    private readonly pgboss: PgBoss,
  ) {
    super();
  }

  /**
   * Sends a job to the PgBoss queue for immediate processing.
   *
   * @typeParam Payload - The type of the job payload.
   * @param name - The name of the registered job to execute.
   * @param payload - The data to pass to the job handler.
   * @returns A promise that resolves when the job has been queued.
   * @throws Error if the job name is not found in the registry.
   */
  async send<Payload extends object>(name: string, payload: Payload): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.send(name, payload);
  }

  /**
   * Schedules a recurring job using a cron expression.
   *
   * The job will be automatically enqueued by pg-boss according to the
   * specified cron schedule. If a schedule already exists for this job,
   * it will be updated with the new cron expression and payload.
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

    await this.pgboss.schedule(name, cron, payload);
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
}
