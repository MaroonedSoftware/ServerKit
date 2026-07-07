import { Job as PgJob, PgBoss } from 'pg-boss';
import { Container, Injectable } from 'injectkit';
import { Job } from '../job.js';
import { JobRunner } from '../job.runner.js';
import { PgBossJobRegistration, PgBossJobRegistryMap } from './pgboss.job.registration.js';
import { Logger } from '@maroonedsoftware/logger';

/**
 * Type guard to check if a registration is a scheduled job configuration.
 *
 * @param registration - The registration to check.
 * @returns True if the registration is a {@link PgBossJobRegistration} with cron schedule.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isPgBossJobRegistration = (registration: any): registration is PgBossJobRegistration => {
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
   * How often, in seconds, a running job polls pg-boss to detect that it has
   * been cancelled. When a poll observes the job is no longer present or its
   * state is `cancelled`, the `AbortSignal` passed to the job's handler is
   * aborted so cooperative handlers can stop. Set to `0` to disable polling
   * (running jobs will then only be interruptible on shutdown/timeout).
   *
   * @default 5
   */
  cancelPollIntervalSeconds = 5;

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
   * Each item in a batch resolves its `Job` instance from the DI container
   * individually and execution is awaited via `Promise.allSettled`, so pg-boss
   * does not acknowledge a batch until every job has actually finished and
   * one job's failure cannot suppress its sibling's logs.
   *
   * @returns A promise that resolves when all workers are registered with pg-boss.
   */
  async start(): Promise<void> {
    await this.pgboss.start();

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

      await this.pgboss.work(name, async (jobs: PgJob<object>[]) => {
        const results = await Promise.allSettled(
          jobs.map(async job => {
            const jobRunner = this.container.get<Job>(identifier);
            const controller = new AbortController();
            // pg-boss aborts `job.signal` on timeout/shutdown; combine it with our
            // own controller, which the cancellation poll aborts. (`signal` is typed
            // as always present, but may be absent when jobs are faked in tests.)
            const pgSignal = (job as { signal?: AbortSignal }).signal;
            const signal = AbortSignal.any(pgSignal ? [controller.signal, pgSignal] : [controller.signal]);
            const stopWatching = this.watchForCancellation(name, job.id, controller);
            try {
              await jobRunner.run(job.data, signal);
            } catch (error) {
              // Log first so a sibling's failure can't suppress this job's diagnostics,
              // then rethrow so `allSettled` records the rejection below.
              this.logger.error(error);
              throw error;
            } finally {
              stopWatching();
            }
          }),
        );

        // Every job in the batch is isolated (they run concurrently and each logs its own
        // error), but the work handler itself must reject when any job threw. Otherwise
        // pg-boss treats the whole batch as completed and never applies retryLimit or
        // dead-lettering to the jobs that actually failed.
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
        if (failures.length === 1) {
          throw failures[0];
        }
        if (failures.length > 1) {
          throw new AggregateError(failures, `${failures.length} of ${jobs.length} jobs in queue "${name}" failed`);
        }
      });
    }
  }

  /**
   * Polls pg-boss for a running job and aborts the given controller when the job
   * has been cancelled (or has disappeared, e.g. via {@link PgBossJobBroker.deleteJob}).
   *
   * This is what turns {@link PgBossJobBroker.cancel} into a signal the running
   * handler can observe, even when `cancel` is called from a different process:
   * the cancellation is a state change on the shared PostgreSQL row, and every
   * runner polls that row for the jobs it is currently executing.
   *
   * @param name - The queue/job name.
   * @param id - The id of the running job to watch.
   * @param controller - The controller to abort once cancellation is detected.
   * @returns A function that stops the poll; always call it when the job finishes.
   * @internal
   */
  private watchForCancellation(name: string, id: string, controller: AbortController): () => void {
    if (this.cancelPollIntervalSeconds <= 0) {
      return () => {};
    }

    const timer = setInterval(async () => {
      try {
        const [job] = await this.pgboss.findJobs(name, { id });
        if (!job || job.state === 'cancelled') {
          controller.abort();
          clearInterval(timer);
        }
      } catch (error) {
        this.logger.error(error);
      }
    }, this.cancelPollIntervalSeconds * 1000);

    // Don't let the poll timer keep the process alive on its own.
    timer.unref?.();

    return () => clearInterval(timer);
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
