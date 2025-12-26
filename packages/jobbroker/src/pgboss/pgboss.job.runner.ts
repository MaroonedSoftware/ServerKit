import { Job as PgJob, PgBoss } from 'pg-boss';
import { Container, Injectable } from 'injectkit';
import { Job } from '../job.js';
import { JobRunner } from '../job.runner.js';
import { PgBossJobRegistration, PgBossJobRegistryMap } from './pgboss.job.registeration.js';
import { Logger } from '@maroonedsoftware/logger';

/**
 * Type guard to check if a registration is a scheduled job configuration.
 *
 * @param registration - The registration to check.
 * @returns True if the registration is a {@link PgBossJobRegistration} with cron schedule.
 * @internal
 */
const isPgBossJobRegistration = (registration: object): registration is PgBossJobRegistration => {
  return registration && 'job' in registration && 'cron' in registration;
};

/**
 * PgBoss implementation of the {@link JobRunner} interface.
 *
 * This runner processes jobs from PostgreSQL queues using pg-boss. It
 * automatically creates queues for registered jobs, sets up scheduled
 * jobs, and handles job execution with error logging.
 *
 * @example
 * ```typescript
 * // Setup
 * const pgboss = new PgBoss('postgres://...');
 * await pgboss.start();
 *
 * const registry = new PgBossJobRegistryMap();
 * registry.set('send-email', SendEmailJob);
 * registry.set('daily-report', {
 *   job: DailyReportJob,
 *   cron: '0 9 * * *'
 * });
 *
 * const runner = new PgBossJobRunner(container, registry, pgboss, logger);
 *
 * // Start processing
 * await runner.start();
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await runner.stop();
 * });
 * ```
 */
@Injectable()
export class PgBossJobRunner extends JobRunner {
  /**
   * Creates a new PgBossJobRunner instance.
   *
   * @param container - The DI container for resolving job instances.
   * @param registrations - The registry map containing all registered jobs.
   * @param pgboss - The pg-boss instance to use for queue operations.
   * @param logger - The logger for recording job execution errors.
   */
  constructor(
    private readonly container: Container,
    private readonly registrations: PgBossJobRegistryMap,
    private readonly pgboss: PgBoss,
    private readonly logger: Logger,
  ) {
    super();
  }

  /**
   * Starts the job runner and begins processing registered jobs.
   *
   * For each registered job, this method:
   * 1. Creates the queue if it doesn't exist
   * 2. Sets up the cron schedule (for scheduled jobs)
   * 3. Starts a worker to process jobs from the queue
   *
   * Job instances are resolved from the DI container for each execution,
   * allowing for proper scoping and dependency injection.
   *
   * @returns A promise that resolves when all workers are set up.
   */
  async start(): Promise<void> {
    for (const [name, registration] of this.registrations.entries()) {
      const queue = await this.pgboss.getQueue(name);
      if (!queue) {
        await this.pgboss.createQueue(name);
      }

      let identifier;
      if (isPgBossJobRegistration(registration)) {
        identifier = registration.job;
        await this.pgboss.schedule(name, registration.cron);
      } else {
        identifier = registration;
      }

      this.pgboss.work(name, async (jobs: PgJob<object>[]) => {
        const jobRunner = this.container.get<Job>(identifier);
        jobs.map(async job => {
          try {
            await jobRunner.run(job.data);
          } catch (error) {
            this.logger.error(error);
          }
        });
      });
    }
  }

  /**
   * Stops the job runner gracefully.
   *
   * This method stops the pg-boss instance, which will:
   * - Stop accepting new jobs
   * - Wait for currently executing jobs to complete
   * - Clean up database connections
   *
   * @returns A promise that resolves when the runner has stopped.
   */
  async stop(): Promise<void> {
    await this.pgboss.stop();
  }
}
