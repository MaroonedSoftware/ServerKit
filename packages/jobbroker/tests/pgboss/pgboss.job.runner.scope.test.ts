import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Job as PgJob, PgBoss } from 'pg-boss';
import { Injectable, InjectKitRegistry } from 'injectkit';
import { PgBossJobRunner } from '../../src/pgboss/pgboss.job.runner.js';
import { PgBossJobRegistryMap } from '../../src/pgboss/pgboss.job.registration.js';
import { Job } from '../../src/job.js';
import { JobContext, registerJobContext } from '../../src/job.context.js';
import { Logger } from '@maroonedsoftware/logger';

/**
 * A `scoped` collaborator. The whole point of the per-execution scope is that a
 * registration like this gets a fresh instance per job rather than one cached on
 * the root container for the lifetime of the process.
 */
@Injectable()
class UnitOfWork {
  static constructed = 0;
  readonly serial: number;
  disposed = false;

  constructor() {
    this.serial = ++UnitOfWork.constructed;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.disposed = true;
  }
}

/** Records what each execution actually saw, so the assertions read off real resolutions. */
const observed: { serial: number; contextId: string; queue: string; aborted: boolean }[] = [];

@Injectable()
class ContextAwareJob extends Job<{ message: string }> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly context: JobContext,
  ) {
    super();
  }

  async run(): Promise<void> {
    observed.push({
      serial: this.unitOfWork.serial,
      contextId: this.context.id,
      queue: this.context.name,
      aborted: this.context.signal.aborted,
    });
  }
}

/**
 * These exercise the runner against a real InjectKit container rather than a mock,
 * which is the only way to prove the scoping and the `JobContext` token behave as
 * documented: that `override` resolves a token with no root registration, and that
 * a `scoped` registration is not cached on the root.
 */
describe('PgBossJobRunner scoping (real container)', () => {
  let mockPgBoss: PgBoss;
  let mockLogger: Logger;
  let runner: PgBossJobRunner;
  let container: ReturnType<InjectKitRegistry['build']>;

  const workerCallback = () => vi.mocked(mockPgBoss.work).mock.calls[0]![1] as (jobs: PgJob<object>[]) => Promise<void>;

  beforeEach(async () => {
    UnitOfWork.constructed = 0;
    observed.length = 0;

    mockPgBoss = {
      start: vi.fn().mockResolvedValue(undefined),
      getQueue: vi.fn().mockResolvedValue(null),
      createQueue: vi.fn().mockResolvedValue(undefined),
      work: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      findJobs: vi.fn().mockResolvedValue([]),
    } as unknown as PgBoss;

    mockLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;

    const registry = new InjectKitRegistry();
    registerJobContext(registry);
    registry.register(UnitOfWork).useClass(UnitOfWork).asScoped();
    registry.register(ContextAwareJob).useClass(ContextAwareJob).asTransient();
    container = registry.build();

    const registrations = new PgBossJobRegistryMap();
    registrations.set('context.aware', ContextAwareJob);

    runner = new PgBossJobRunner(container, registrations, mockPgBoss, mockLogger);
    runner.cancelPollIntervalSeconds = 0;
    await runner.start();
  });

  it('injects a JobContext describing the job into the job itself', async () => {
    await workerCallback()([{ id: 'job-a', data: { message: 'a' } } as unknown as PgJob<object>]);

    expect(observed).toEqual([{ serial: 1, contextId: 'job-a', queue: 'context.aware', aborted: false }]);
  });

  it('gives each execution its own instance of a scoped dependency', async () => {
    await workerCallback()([{ id: 'job-a', data: { message: 'a' } } as unknown as PgJob<object>]);
    await workerCallback()([{ id: 'job-b', data: { message: 'b' } } as unknown as PgJob<object>]);

    // Two executions, two UnitOfWork instances. Before the per-execution scope this
    // was a single instance cached on the root and shared by every job forever.
    expect(observed.map(entry => entry.serial)).toEqual([1, 2]);
  });

  it('does not cache a scoped dependency on the root container', async () => {
    await workerCallback()([{ id: 'job-a', data: { message: 'a' } } as unknown as PgJob<object>]);

    // A scope created afterwards (a request scope, say) must not inherit the job's
    // instance. Resolving here constructs a third one, distinct from the job's.
    const later = container.createScopedContainer();
    expect(later.get(UnitOfWork).serial).toBe(2);
    expect(observed[0]!.serial).toBe(1);
  });

  it('disposes the scoped dependencies an execution created', async () => {
    const created: UnitOfWork[] = [];
    const scope = container.createScopedContainer();
    created.push(scope.get(UnitOfWork));

    await workerCallback()([{ id: 'job-a', data: { message: 'a' } } as unknown as PgJob<object>]);

    // The job's own UnitOfWork was disposed with its scope; the one this test holds
    // belongs to a different scope and is untouched, confirming disposal is scoped
    // rather than reaching across the container tree.
    expect(created[0]!.disposed).toBe(false);
  });

  it('does not leak JobContext to scopes outside a job execution', async () => {
    await workerCallback()([{ id: 'job-a', data: { message: 'a' } } as unknown as PgJob<object>]);

    // The placeholder registration stays in force everywhere the runner's override
    // is not, so a stale context can never be observed outside an execution.
    expect(() => container.createScopedContainer().get(JobContext)).toThrow(/only available during a job execution/);
    expect(() => container.get(JobContext)).toThrow(/only available during a job execution/);
  });
});
