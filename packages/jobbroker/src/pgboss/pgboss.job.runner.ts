import { Job as PgJob, PgBoss } from 'pg-boss';
import { Container, Injectable } from 'injectkit';
import { Job } from '../job.js';
import { JobQueuePolicy } from '../job.queue.policy.js';
import { JobRunner } from '../job.runner.js';
import { PgBossJobRegistration, PgBossJobRegistryMap } from './pgboss.job.registration.js';
import { Logger } from '@maroonedsoftware/logger';

/**
 * pg-boss queue options as accepted by `createQueue`/`updateQueue`. Derived from
 * the installed pg-boss types so the mapping tracks the peer's exact shape.
 * @internal
 */
type PgBossQueueOptions = NonNullable<Parameters<PgBoss['updateQueue']>[1]>;

/**
 * Type guard to check if a registration is the object configuration form
 * (carrying a cron schedule, a queue policy, or both) rather than a bare job
 * identifier.
 *
 * @param registration - The registration to check.
 * @returns True if the registration is a {@link PgBossJobRegistration} object.
 * @internal
 */
const isPgBossJobRegistration = (registration: unknown): registration is PgBossJobRegistration => {
  return typeof registration === 'object' && registration !== null && 'job' in registration;
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
   * A base {@link JobQueuePolicy} applied to *every* registered queue, beneath
   * each queue's own policy. Set it to give all queues sane retry/dead-letter
   * defaults without repeating them on each registration; a field a queue sets
   * on its own `policy` overrides the same field here.
   *
   * Leave it unset (the default) to opt in per queue only. When neither this nor
   * a queue's own policy supplies any option, that queue is created exactly as
   * before, with no options passed.
   *
   * @default undefined
   */
  defaultQueuePolicy?: JobQueuePolicy;

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
   * 1. Resolves the effective queue policy (the runner's {@link defaultQueuePolicy}
   *    merged with the registration's own policy, if any)
   * 2. Auto-creates any dead-letter queue the policy references, before the queue
   *    that references it
   * 3. Creates the queue with the policy's options if it doesn't exist, or updates
   *    an existing queue to match; when no policy applies, the queue is created
   *    with the name only (unchanged pre-policy behavior)
   * 4. Sets up the cron schedule (for scheduled jobs)
   * 5. Starts a worker to process jobs from the queue
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

    // Tracks queues we have already ensured exist during this start pass, so a
    // dead-letter queue referenced by several policies is only created once.
    const ensured = new Set<string>();

    for (const [name, registration] of this.registrations.entries()) {
      const policy = this.resolvePolicy(registration);

      // A dead-letter queue must exist before a queue that references it is
      // created, so ensure it first (as a plain queue) when it is not itself a
      // registered queue that a later iteration would create.
      if (policy?.deadLetter) {
        await this.ensureQueue(policy.deadLetter, undefined, ensured);
      }

      await this.ensureQueue(name, policy, ensured);

      let identifier;
      if (isPgBossJobRegistration(registration)) {
        identifier = registration.job;
        if (registration.cron) {
          await this.pgboss.schedule(name, registration.cron);
        }
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
   * Merges the runner-wide {@link defaultQueuePolicy} with a registration's own
   * policy, letting the registration override individual fields. Returns
   * `undefined` when neither supplies a policy, so a queue with no policy is left
   * to pg-boss defaults and created exactly as it was before this feature.
   *
   * @param registration - The registry entry (a bare identifier or an object).
   * @returns The effective policy for the queue, or `undefined` if none applies.
   * @internal
   */
  private resolvePolicy(registration: unknown): JobQueuePolicy | undefined {
    const own = isPgBossJobRegistration(registration) ? registration.policy : undefined;
    if (!this.defaultQueuePolicy && !own) {
      return undefined;
    }
    return { ...this.defaultQueuePolicy, ...own };
  }

  /**
   * Ensures a queue exists and, when a policy is supplied, that its retry and
   * dead-letter options match. Creates the queue (with options) when absent, and
   * updates an existing queue's options when a policy is given. When no policy
   * option resolves, an absent queue is created with the name only — byte-for-byte
   * the pre-policy behavior — and an existing queue is left untouched.
   *
   * @param name - The queue name to ensure.
   * @param policy - The effective policy, or `undefined` for none.
   * @param ensured - Names already ensured during this start pass (mutated).
   * @internal
   */
  private async ensureQueue(name: string, policy: JobQueuePolicy | undefined, ensured: Set<string>): Promise<void> {
    if (ensured.has(name)) {
      return;
    }
    ensured.add(name);

    const options = policy ? this.toQueueOptions(policy) : undefined;
    const queue = await this.pgboss.getQueue(name);

    if (!queue) {
      if (options) {
        await this.pgboss.createQueue(name, options);
      } else {
        await this.pgboss.createQueue(name);
      }
      return;
    }

    if (options) {
      await this.pgboss.updateQueue(name, options);
    }
  }

  /**
   * Maps a backend-agnostic {@link JobQueuePolicy} onto pg-boss's native queue
   * options. Luxon {@link Duration}s become whole-second counts (pg-boss measures
   * these in seconds). Returns `undefined` when the policy carries no options to
   * apply, so callers fall back to the name-only create/no-op update path.
   *
   * @param policy - The effective policy for a queue.
   * @returns The pg-boss queue options, or `undefined` if the policy is empty.
   * @internal
   */
  private toQueueOptions(policy: JobQueuePolicy): PgBossQueueOptions | undefined {
    const options: PgBossQueueOptions = {};
    if (policy.retryLimit !== undefined) {
      options.retryLimit = policy.retryLimit;
    }
    if (policy.retryDelay !== undefined) {
      options.retryDelay = Math.round(policy.retryDelay.as('seconds'));
    }
    if (policy.retryBackoff !== undefined) {
      options.retryBackoff = policy.retryBackoff;
    }
    if (policy.retryDelayMax !== undefined) {
      options.retryDelayMax = Math.round(policy.retryDelayMax.as('seconds'));
    }
    if (policy.expiresIn !== undefined) {
      options.expireInSeconds = Math.round(policy.expiresIn.as('seconds'));
    }
    if (policy.deadLetter !== undefined) {
      options.deadLetter = policy.deadLetter;
    }
    return Object.keys(options).length > 0 ? options : undefined;
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
