import { Injectable, Registry } from 'injectkit';
import { Duration } from 'luxon';

/**
 * Metadata describing the job execution currently in flight.
 *
 * A {@link JobRunner} registers this against the {@link JobContext} injection token
 * in the per-execution scoped container, so any service resolved during that
 * execution can declare `JobContext` as a constructor dependency and see which
 * job it is running under. This is the job-side counterpart of ServerKit's
 * request context: it is what lets a logger, a metrics recorder, or an outbox
 * writer sitting deep in the dependency graph attribute its work to a job
 * without every layer threading the metadata through by hand.
 *
 * Only fields every backend can supply are declared here. In particular there is
 * no attempt/retry counter: pg-boss hands the work handler a bare `Job`, and the
 * retry count lives on `JobWithMetadata`, which would cost an extra query per
 * execution to fetch. Read it from {@link JobMonitor} when you need it.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class AuditLog {
 *   constructor(private readonly context: JobContext) {}
 *
 *   record(message: string): void {
 *     // Attributed to the job automatically, with no plumbing at the call site.
 *     logger.info({ jobId: this.context.id, queue: this.context.name }, message);
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface JobContext {
  /** Backend-assigned identifier of the running job. Matches the id `JobBroker.send` returned. */
  id: string;
  /** Name of the queue the job was dequeued from, which is also its registered job name. */
  name: string;
  /**
   * Aborted when the job is cancelled (see {@link JobBroker.cancel}) or when the
   * runner shuts down. The same signal the runner passes to {@link Job.run}, exposed
   * here so collaborators can observe cancellation without the handler forwarding it.
   */
  signal: AbortSignal;
  /**
   * How long the backend allows this execution to run before it is considered
   * expired, when the backend reports a limit. Useful for deciding whether there
   * is time left to start another unit of work.
   */
  expiresIn?: Duration;
}

/**
 * Abstract class merged with the {@link JobContext} interface so it can serve as an
 * injectkit injection token. A {@link JobRunner} registers the live context against
 * this token in the execution-scoped container, so services can inject `JobContext`
 * and receive the job currently being run.
 *
 * Resolving it outside a job execution throws, exactly as resolving ServerKit's
 * request context outside a request does. A service that must work in both places
 * should not depend on it directly.
 */
@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class JobContext implements JobContext {}

/**
 * Registers the {@link JobContext} token so services may declare it as a dependency.
 *
 * Call this on the registry whenever any registered service injects `JobContext`.
 * `Registry.build()` validates the dependency graph up front and rejects a service
 * whose dependency has no registration, and the runner's per-execution override
 * cannot satisfy that check because it only exists at runtime, inside a scope.
 *
 * What this registers is a placeholder that throws when resolved. During a job the
 * runner's scoped override shadows it, so the real context is what gets injected;
 * anywhere else (at boot, in a request, from a singleton) resolution fails with an
 * explanation rather than handing back a fake context.
 *
 * @param registry - The registry to register into, before `build()`.
 * @returns The registry, for chaining.
 *
 * @example
 * ```typescript
 * const registry = new InjectKitRegistry();
 * registerJobContext(registry);
 * registry.register(SendEmailJob).useClass(SendEmailJob).asTransient();
 * const container = registry.build();
 * ```
 */
export const registerJobContext = <T extends Registry>(registry: T): T => {
  registry
    .register(JobContext)
    .useFactory(() => {
      throw new Error(
        'JobContext is only available during a job execution. It cannot be resolved at boot, from a request scope, or from a singleton.',
      );
    })
    .asScoped();
  return registry;
};
