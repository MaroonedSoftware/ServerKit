import { Job as PgJob, JobResult, PgBoss } from 'pg-boss';
import { Duration } from 'luxon';
import { Container, Injectable } from 'injectkit';
import { Job } from '../job.js';
import { JobContext } from '../job.context.js';
import { JobQueuePolicy } from '../job.queue.policy.js';
import { JobRunner } from '../job.runner.js';
import { JobWorkerPolicy } from '../job.worker.policy.js';
import { PermanentJobError } from '../permanent.job.error.js';
import { PgBossJobRegistration, PgBossJobRegistryMap } from './pgboss.job.registration.js';
import { Logger } from '@maroonedsoftware/logger';
import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * pg-boss queue options as accepted by `createQueue`/`updateQueue`. Derived from
 * the installed pg-boss types so the mapping tracks the peer's exact shape.
 * @internal
 */
type PgBossQueueOptions = NonNullable<Parameters<PgBoss['updateQueue']>[1]>;

/**
 * pg-boss work options as accepted by the three-argument `work` overload.
 * Derived from the installed pg-boss types so the mapping tracks the peer's
 * exact shape.
 * @internal
 */
type PgBossWorkOptions = NonNullable<Parameters<PgBoss['work']>[1]>;

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
 * Each job settles on its own: the runner reports a per-job outcome to pg-boss
 * rather than throwing, so one failure retries and dead-letters alone instead of
 * dragging the rest of its batch with it. A job that throws
 * {@link PermanentJobError} skips its remaining retries and dead-letters on the
 * first attempt.
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
   * A base {@link JobWorkerPolicy} applied to *every* queue this runner starts a
   * worker for, beneath each queue's own `worker` policy. Set it to give all
   * queues the same concurrency or poll interval without repeating them on each
   * registration; a field a queue sets on its own `worker` overrides the same
   * field here.
   *
   * Unlike {@link defaultQueuePolicy} this is not stored on the queue — it
   * configures the workers *this process* starts, so another node consuming the
   * same queues may use different values.
   *
   * Leave it unset (the default) to opt in per queue only. A queue with no policy
   * from either side runs on pg-boss's own worker defaults: one worker, one job
   * per fetch.
   *
   * @default undefined
   */
  defaultWorkerPolicy?: JobWorkerPolicy;

  /**
   * Creates a new PgBossJobRunner instance.
   *
   * @param container - The root DI container. Each job execution resolves from a
   *                    scope created off it, not from the container itself.
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
   * 5. Starts a worker to process jobs from the queue, with the effective worker
   *    policy (the runner's {@link defaultWorkerPolicy} merged with the
   *    registration's own `worker`, if any) applied
   *
   * Each item in a batch runs in its own scoped container, created from the
   * injected root container and disposed once the item settles, so `scoped`
   * registrations behave per execution (the job-side equivalent of a request
   * scope) and any disposables the execution created are released. Each scope
   * carries a {@link JobContext} describing the running job, so the job and its
   * collaborators can inject it. Execution is
   * awaited via `Promise.allSettled`, so pg-boss does not acknowledge a batch
   * until every job has actually finished and one job's failure cannot suppress
   * its sibling's logs.
   *
   * Workers run with pg-boss's `perJobResults`, so the handler reports each job's
   * outcome rather than throwing: a job that fails is retried and dead-lettered on
   * its own, without dragging the rest of its batch along. A job that throws
   * {@link PermanentJobError} skips its remaining retries and dead-letters
   * immediately.
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

      const handler = async (jobs: PgJob<object>[]): Promise<JobResult[]> => {
        const results = await Promise.allSettled(
          jobs.map(async job => {
            // Every execution resolves from its own scope, never the root container.
            // InjectKit caches a `scoped` registration in whichever container first
            // resolves it, and child scopes inherit a parent's cache, so resolving a
            // scoped token at the root would turn it into a process-lifetime singleton
            // shared by every job *and* inherited by every later request scope.
            const scope = this.container.createScopedContainer();
            const controller = new AbortController();
            // pg-boss aborts `job.signal` on timeout/shutdown; combine it with our
            // own controller, which the cancellation poll aborts. (`signal` is typed
            // as always present, but may be absent when jobs are faked in tests.)
            const pgSignal = (job as { signal?: AbortSignal }).signal;
            const signal = AbortSignal.any(pgSignal ? [controller.signal, pgSignal] : [controller.signal]);
            // Assigned once the watch starts; until then there is nothing to stop, so
            // `finally` can run unconditionally even if resolution threw.
            let stopWatching = () => {};
            try {
              // Override before resolving, so a job (or anything it depends on) may
              // take JobContext as a constructor dependency.
              scope.override(JobContext, this.toJobContext(name, job, signal));
              const jobRunner = scope.get<Job>(identifier);
              stopWatching = this.watchForCancellation(name, job.id, controller);
              await jobRunner.run(job.data, signal);
            } catch (error) {
              // Log first so a sibling's failure can't suppress this job's diagnostics,
              // then rethrow so `allSettled` records the rejection below.
              this.logger.error(error);
              throw error;
            } finally {
              // Stop the poll before disposing: resolving from a disposed scope throws,
              // and a late tick must not turn a finished job into a logged error.
              stopWatching();
              // Log rather than rethrow, so a disposal failure can't replace the job's
              // real error and mislead pg-boss's retry/dead-letter accounting.
              await scope.disposeAsync().catch((error: unknown) => this.logger.error(error));
            }
          }),
        );

        // Under `perJobResults` the handler reports each job's outcome instead of
        // throwing, so pg-boss settles them individually: one poisoned job fails (and
        // retries, and dead-letters) alone rather than dragging its whole batch with it.
        // Throwing from here still fails the entire batch, which is what a runner-level
        // bug — as opposed to a job-level one — should do.
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
        if (failures.length > 1) {
          // The per-job errors are already logged above and are about to be persisted as
          // each job's own output. This adds back the batch-wide view that the pre-
          // `perJobResults` AggregateError carried, as a log line rather than as a
          // settlement decision — the cause keeps every individual error reachable.
          this.logger.error(
            new ServerkitError(`${failures.length} of ${jobs.length} jobs in queue "${name}" failed`).withCause(new AggregateError(failures)),
          );
        }

        // Map over `jobs`, not `results`: pg-boss matches dispositions by job id and
        // fails any job the handler omits, so the batch itself must drive the output.
        return jobs.map((job, index) => {
          const result = results[index];
          // `allSettled` returns one entry per input, so a missing entry is impossible;
          // treat it as a failure anyway rather than silently completing a job that may
          // never have run.
          if (result?.status === 'fulfilled') {
            return { id: job.id, status: 'completed' };
          }
          // A job that declares its own failure permanent skips its remaining retries
          // and goes straight to the queue's dead-letter queue.
          const status = result?.reason instanceof PermanentJobError ? 'deadletter' : 'failed';
          return { id: job.id, status, output: result?.reason };
        });
      };

      await this.pgboss.work(name, this.toWorkOptions(this.resolveWorkerPolicy(registration)), handler);
    }
  }

  /**
   * Builds the {@link JobContext} registered in an execution's scoped container.
   *
   * @param name - The queue the job was dequeued from.
   * @param job - The pg-boss job being executed.
   * @param signal - The combined cancellation signal handed to {@link Job.run}.
   * @returns The context describing this execution.
   * @internal
   */
  private toJobContext(name: string, job: PgJob<object>, signal: AbortSignal): JobContext {
    // Typed as always present, but absent when jobs are faked in tests, so it is
    // read defensively and simply omitted when the backend reports no limit.
    const expireInSeconds = (job as { expireInSeconds?: number }).expireInSeconds;
    return {
      id: job.id,
      name,
      signal,
      ...(expireInSeconds === undefined ? {} : { expiresIn: Duration.fromObject({ seconds: expireInSeconds }) }),
    };
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
   * Merges the runner-wide {@link defaultWorkerPolicy} with a registration's own
   * `worker` policy, letting the registration override individual fields. Returns
   * `undefined` when neither supplies a policy, so a queue with no policy keeps
   * pg-boss's own worker defaults.
   *
   * @param registration - The registry entry (a bare identifier or an object).
   * @returns The effective worker policy for the queue, or `undefined` if none applies.
   * @internal
   */
  private resolveWorkerPolicy(registration: unknown): JobWorkerPolicy | undefined {
    const own = isPgBossJobRegistration(registration) ? registration.worker : undefined;
    if (!this.defaultWorkerPolicy && !own) {
      return undefined;
    }
    return { ...this.defaultWorkerPolicy, ...own };
  }

  /**
   * Maps a backend-agnostic {@link JobWorkerPolicy} onto pg-boss's native work
   * options. `pollInterval` is passed as a fractional second count rather than
   * rounded — pg-boss accepts intervals down to 0.5s, so rounding would turn a
   * deliberate sub-second poll into either 0 (rejected) or 1.
   *
   * Always returns options, because `perJobResults` is always on: it is what makes
   * pg-boss settle each job in a batch individually, and what gives
   * {@link PermanentJobError} somewhere to land. A queue with no worker policy
   * still gets that, and nothing else.
   *
   * @param policy - The effective worker policy for a queue, or `undefined`.
   * @returns The pg-boss work options.
   * @internal
   */
  private toWorkOptions(policy: JobWorkerPolicy | undefined): PgBossWorkOptions {
    const options: PgBossWorkOptions = { perJobResults: true };
    if (policy?.concurrency !== undefined) {
      options.localConcurrency = policy.concurrency;
    }
    if (policy?.batchSize !== undefined) {
      options.batchSize = policy.batchSize;
    }
    if (policy?.pollInterval !== undefined) {
      options.pollingIntervalSeconds = policy.pollInterval.as('seconds');
    }
    return options;
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
