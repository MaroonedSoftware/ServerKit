import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { Duration } from 'luxon';
import { Job as PgJob, JobResult, PgBoss } from 'pg-boss';
import { Container, ScopedContainer } from 'injectkit';
import { PgBossJobRunner } from '../../src/pgboss/pgboss.job.runner.js';
import { PgBossJobRegistryMap } from '../../src/pgboss/pgboss.job.registration.js';
import { Job } from '../../src/job.js';
import { JobContext } from '../../src/job.context.js';
import { PermanentJobError } from '../../src/permanent.job.error.js';
import { Logger } from '@maroonedsoftware/logger';
import { ServerkitError } from '@maroonedsoftware/errors';

class TestJob extends Job<{ message: string }> {
  async run(payload: { message: string }, _signal?: AbortSignal): Promise<void> {
    console.log(payload.message);
  }
}

describe('PgBossJobRunner', () => {
  let mockPgBoss: PgBoss;
  let mockContainer: Container;
  /** Every scope handed out by `mockContainer.createScopedContainer`, in creation order. */
  let scopes: { get: Mock; override: Mock; disposeAsync: Mock }[];
  let mockLogger: Logger;
  let registrations: PgBossJobRegistryMap;
  let runner: PgBossJobRunner;
  let testJobInstance: TestJob;

  beforeEach(() => {
    testJobInstance = new TestJob();
    vi.spyOn(testJobInstance, 'run').mockResolvedValue(undefined);

    mockPgBoss = {
      start: vi.fn().mockResolvedValue(undefined),
      getQueue: vi.fn().mockResolvedValue(null),
      createQueue: vi.fn().mockResolvedValue(undefined),
      updateQueue: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined),
      work: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as PgBoss;

    // The runner must resolve jobs from a per-execution scope, never from the root
    // container, so the root's `get` is deliberately left un-stubbed: calling it fails.
    scopes = [];
    mockContainer = {
      get: vi.fn(() => {
        throw new Error('jobs must be resolved from a scoped container, not the root');
      }),
      createScopedContainer: vi.fn(() => {
        const scope = {
          get: vi.fn().mockReturnValue(testJobInstance),
          override: vi.fn(),
          disposeAsync: vi.fn().mockResolvedValue(undefined),
        };
        scopes.push(scope);
        return scope as unknown as ScopedContainer;
      }),
    } as unknown as Container;

    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    } as unknown as Logger;

    registrations = new PgBossJobRegistryMap();
    registrations.set('test-job', TestJob);

    runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The handler the runner registered for the first queue. It sits at index 2 because
   * `work` is always called with an options object — `perJobResults` is unconditional.
   */
  const getWorkerCallback = () => vi.mocked(mockPgBoss.work).mock.calls[0]![2] as unknown as (jobs: PgJob<object>[]) => Promise<JobResult[]>;

  describe('start', () => {
    it('should create queue if it does not exist', async () => {
      await runner.start();

      expect(mockPgBoss.getQueue).toHaveBeenCalledWith('test-job');
      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('test-job');
    });

    it('should not create queue if it already exists', async () => {
      vi.mocked(mockPgBoss.getQueue).mockResolvedValue({
        name: 'test-job',
      } as unknown as ReturnType<PgBoss['getQueue']> extends Promise<infer T> ? T : never);

      await runner.start();

      expect(mockPgBoss.getQueue).toHaveBeenCalledWith('test-job');
      expect(mockPgBoss.createQueue).not.toHaveBeenCalled();
    });

    it('should register worker for each job', async () => {
      await runner.start();

      expect(mockPgBoss.work).toHaveBeenCalledOnce();
      expect(mockPgBoss.work).toHaveBeenCalledWith('test-job', { perJobResults: true }, expect.any(Function));
    });

    it('should schedule job for cron-configured registrations', async () => {
      registrations.clear();
      registrations.set('cron-job', { job: TestJob, cron: '0 0 * * *' });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.schedule).toHaveBeenCalledWith('cron-job', '0 0 * * *');
    });

    it('should not schedule job for simple identifier registrations', async () => {
      await runner.start();

      expect(mockPgBoss.schedule).not.toHaveBeenCalled();
    });

    it('should handle multiple job registrations', async () => {
      registrations.set('job-1', TestJob);
      registrations.set('job-2', TestJob);
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      // 3 jobs total: test-job, job-1, job-2
      expect(mockPgBoss.work).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed registration types', async () => {
      registrations.set('simple-job', TestJob);
      registrations.set('cron-job', { job: TestJob, cron: '*/5 * * * *' });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.schedule).toHaveBeenCalledOnce();
      expect(mockPgBoss.schedule).toHaveBeenCalledWith('cron-job', '*/5 * * * *');
      expect(mockPgBoss.work).toHaveBeenCalledTimes(3);
    });
  });

  describe('job worker callback', () => {
    it('should resolve job from a scoped container and execute run method', async () => {
      await runner.start();

      // Get the worker callback
      const workerCallback = getWorkerCallback();

      const mockJobs: PgJob<object>[] = [{ id: 'job-1', data: { message: 'Hello' } } as unknown as PgJob<object>];

      await workerCallback(mockJobs);

      expect(scopes).toHaveLength(1);
      expect(scopes[0]!.get).toHaveBeenCalledWith(TestJob);
      expect(mockContainer.get).not.toHaveBeenCalled();
      expect(testJobInstance.run).toHaveBeenCalledWith({ message: 'Hello' }, expect.any(AbortSignal));
    });

    it('should process multiple jobs', async () => {
      await runner.start();

      const workerCallback = getWorkerCallback();

      const mockJobs: PgJob<object>[] = [
        { id: 'job-1', data: { message: 'First' } } as unknown as PgJob<object>,
        {
          id: 'job-2',
          data: { message: 'Second' },
        } as unknown as PgJob<object>,
        { id: 'job-3', data: { message: 'Third' } } as unknown as PgJob<object>,
      ];

      await workerCallback(mockJobs);

      expect(testJobInstance.run).toHaveBeenCalledTimes(3);
    });

    it('should log the error and report the job failed when job execution fails', async () => {
      const testError = new Error('Job failed');
      vi.spyOn(testJobInstance, 'run').mockRejectedValue(testError);

      await runner.start();

      const workerCallback = getWorkerCallback();

      const mockJobs: PgJob<object>[] = [{ id: 'job-1', data: { message: 'Hello' } } as unknown as PgJob<object>];

      // The callback reports the failure per job rather than throwing, so pg-boss applies
      // retryLimit / dead-lettering to this job alone instead of acking the batch complete.
      await expect(workerCallback(mockJobs)).resolves.toEqual([{ id: 'job-1', status: 'failed', output: testError }]);

      expect(mockLogger.error).toHaveBeenCalledWith(testError);
    });

    it('does not log a batch summary when only one job fails', async () => {
      // Guards the `> 1` threshold: perJobResults is always on, so a default batchSize of 1
      // takes this path on every failure and a summary would double-log the common case.
      const testError = new Error('Job failed');
      vi.spyOn(testJobInstance, 'run').mockRejectedValue(testError);

      await runner.start();

      await getWorkerCallback()([{ id: 'job-1', data: { message: 'Hello' } } as unknown as PgJob<object>]);

      expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(testError);
    });

    it('should continue processing other jobs when one fails, reporting only that job failed', async () => {
      let callCount = 0;
      const secondError = new Error('Second job failed');
      vi.spyOn(testJobInstance, 'run').mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw secondError;
        }
      });

      await runner.start();

      const workerCallback = getWorkerCallback();

      const mockJobs: PgJob<object>[] = [
        { id: 'job-1', data: { message: 'First' } } as unknown as PgJob<object>,
        {
          id: 'job-2',
          data: { message: 'Second' },
        } as unknown as PgJob<object>,
        { id: 'job-3', data: { message: 'Third' } } as unknown as PgJob<object>,
      ];

      // A single bad job neither stops its siblings (all three run) nor drags them into
      // its retry: they settle completed, and only the one that threw is failed.
      await expect(workerCallback(mockJobs)).resolves.toEqual([
        { id: 'job-1', status: 'completed' },
        { id: 'job-2', status: 'failed', output: secondError },
        { id: 'job-3', status: 'completed' },
      ]);

      expect(testJobInstance.run).toHaveBeenCalledTimes(3);
    });

    it('fails each job on its own and logs a batch summary when multiple jobs throw', async () => {
      const errors = [new Error('a failed'), new Error('b failed')];
      let callCount = 0;
      vi.spyOn(testJobInstance, 'run').mockImplementation(async () => {
        throw errors[callCount++]!;
      });

      await runner.start();

      const workerCallback = getWorkerCallback();

      const mockJobs: PgJob<object>[] = [
        { id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>,
        { id: 'job-2', data: { message: 'b' } } as unknown as PgJob<object>,
      ];

      // Each job carries its own error as its own output — strictly more than the single
      // AggregateError the pre-perJobResults handler threw.
      await expect(workerCallback(mockJobs)).resolves.toEqual([
        { id: 'job-1', status: 'failed', output: errors[0] },
        { id: 'job-2', status: 'failed', output: errors[1] },
      ]);

      // Both errors individually, plus one summary that keeps the batch-wide view.
      expect(mockLogger.error).toHaveBeenCalledTimes(3);
      expect(mockLogger.error).toHaveBeenNthCalledWith(1, errors[0]);
      expect(mockLogger.error).toHaveBeenNthCalledWith(2, errors[1]);

      const summary = vi.mocked(mockLogger.error).mock.calls[2]![0] as ServerkitError;
      expect(summary).toBeInstanceOf(ServerkitError);
      expect(summary.message).toBe('2 of 2 jobs in queue "test-job" failed');
      expect(summary.cause).toBeInstanceOf(AggregateError);
      expect((summary.cause as AggregateError).errors).toEqual(errors);
    });

    it('does not resolve the worker callback until every job in the batch has settled', async () => {
      // Regression: an earlier implementation used a fire-and-forget `jobs.map`
      // which returned before any per-job promise settled, so pg-boss would ack
      // the batch and lose the in-flight execution if the process restarted.
      let resolveJob: (() => void) | undefined;
      const inFlight = new Promise<void>(resolve => {
        resolveJob = resolve;
      });
      vi.spyOn(testJobInstance, 'run').mockReturnValue(inFlight);

      await runner.start();
      const workerCallback = getWorkerCallback();

      const callbackPromise = workerCallback([{ id: 'job-1', data: { message: 'wait' } } as unknown as PgJob<object>]);
      let settled = false;
      const tracked = callbackPromise.then(() => {
        settled = true;
      });

      await new Promise(resolve => setImmediate(resolve));
      expect(settled).toBe(false);

      resolveJob!();
      await tracked;
      expect(settled).toBe(true);
    });

    it('resolves each item in the batch from its own scope', async () => {
      // The DI container may register the Job as transient or scoped; sharing one
      // scope (or the root) across concurrent jobs would corrupt per-execution state.
      await runner.start();
      const workerCallback = getWorkerCallback();

      await workerCallback([
        { id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>,
        { id: 'job-2', data: { message: 'b' } } as unknown as PgJob<object>,
        { id: 'job-3', data: { message: 'c' } } as unknown as PgJob<object>,
      ]);

      expect(scopes).toHaveLength(3);
      for (const scope of scopes) {
        expect(scope.get).toHaveBeenCalledTimes(1);
        expect(scope.get).toHaveBeenCalledWith(TestJob);
      }
    });

    it('registers a JobContext describing the running job', async () => {
      await runner.start();
      const workerCallback = getWorkerCallback();

      await workerCallback([{ id: 'job-1', data: { message: 'a' }, expireInSeconds: 90 } as unknown as PgJob<object>]);

      expect(scopes[0]!.override).toHaveBeenCalledWith(JobContext, {
        id: 'job-1',
        name: 'test-job',
        signal: expect.any(AbortSignal),
        expiresIn: Duration.fromObject({ seconds: 90 }),
      });
    });

    it('omits expiresIn when the backend reports no expiry', async () => {
      await runner.start();
      const workerCallback = getWorkerCallback();

      await workerCallback([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>]);

      const context = scopes[0]!.override.mock.calls[0]![1] as JobContext;
      expect(context).not.toHaveProperty('expiresIn');
    });

    it('exposes the same signal on the context that it passes to run', async () => {
      await runner.start();
      const workerCallback = getWorkerCallback();

      await workerCallback([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>]);

      const context = scopes[0]!.override.mock.calls[0]![1] as JobContext;
      expect(vi.mocked(testJobInstance.run).mock.calls[0]![1]).toBe(context.signal);
    });

    it('registers the context before resolving the job, so the job can inject it', async () => {
      // A job that depends on JobContext is constructed during `scope.get`, so the
      // override has to already be in place by then.
      await runner.start();
      const workerCallback = getWorkerCallback();

      await workerCallback([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>]);

      expect(scopes[0]!.override.mock.invocationCallOrder[0]!).toBeLessThan(scopes[0]!.get.mock.invocationCallOrder[0]!);
    });

    it('gives each item in a batch its own context', async () => {
      await runner.start();
      const workerCallback = getWorkerCallback();

      await workerCallback([
        { id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>,
        { id: 'job-2', data: { message: 'b' } } as unknown as PgJob<object>,
      ]);

      const ids = scopes.map(scope => (scope.override.mock.calls[0]![1] as JobContext).id);
      expect(ids).toEqual(['job-1', 'job-2']);
    });

    it('logs and reports a failure to resolve the job, and still disposes the scope', async () => {
      const resolutionError = new Error('no registration');
      vi.mocked(mockContainer.createScopedContainer).mockImplementation(() => {
        const scope = {
          get: vi.fn(() => {
            throw resolutionError;
          }),
          override: vi.fn(),
          disposeAsync: vi.fn().mockResolvedValue(undefined),
        };
        scopes.push(scope);
        return scope as unknown as ScopedContainer;
      });

      await runner.start();
      const workerCallback = getWorkerCallback();

      await expect(workerCallback([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>])).resolves.toEqual([
        { id: 'job-1', status: 'failed', output: resolutionError },
      ]);

      expect(mockLogger.error).toHaveBeenCalledWith(resolutionError);
      expect(scopes[0]!.disposeAsync).toHaveBeenCalledTimes(1);
    });

    it('disposes each execution scope once the job settles', async () => {
      await runner.start();
      const workerCallback = getWorkerCallback();

      await workerCallback([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>]);

      expect(scopes[0]!.disposeAsync).toHaveBeenCalledTimes(1);
    });

    it('disposes the execution scope when the job throws', async () => {
      const failure = new Error('job failed');
      vi.mocked(testJobInstance.run).mockRejectedValue(failure);

      await runner.start();
      const workerCallback = getWorkerCallback();

      await expect(workerCallback([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>])).resolves.toEqual([
        { id: 'job-1', status: 'failed', output: failure },
      ]);

      expect(scopes[0]!.disposeAsync).toHaveBeenCalledTimes(1);
    });

    it('logs a disposal failure without masking the job result', async () => {
      const disposalError = new Error('dispose blew up');
      vi.mocked(mockContainer.createScopedContainer).mockImplementation(() => {
        const scope = {
          get: vi.fn().mockReturnValue(testJobInstance),
          override: vi.fn(),
          disposeAsync: vi.fn().mockRejectedValue(disposalError),
        };
        scopes.push(scope);
        return scope as unknown as ScopedContainer;
      });

      await runner.start();
      const workerCallback = getWorkerCallback();

      // The job still reports completed — a failed teardown must not be reported to
      // pg-boss as a failed job, which would trigger a spurious retry or dead-letter.
      await expect(workerCallback([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>])).resolves.toEqual([
        { id: 'job-1', status: 'completed' },
      ]);
      expect(mockLogger.error).toHaveBeenCalledWith(disposalError);
    });

    it('should use correct job identifier from cron registration', async () => {
      registrations.clear();
      registrations.set('cron-job', { job: TestJob, cron: '0 0 * * *' });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      const workerCallback = getWorkerCallback();

      const mockJobs: PgJob<object>[] = [
        {
          id: 'job-1',
          data: { message: 'Cron job' },
        } as unknown as PgJob<object>,
      ];

      await workerCallback(mockJobs);

      expect(scopes[0]!.get).toHaveBeenCalledWith(TestJob);
    });
  });

  describe('cooperative cancellation', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('aborts the signal passed to run when pg-boss reports the job cancelled', async () => {
      vi.useFakeTimers();
      mockPgBoss.findJobs = vi.fn().mockResolvedValue([{ id: 'job-1', name: 'test-job', state: 'cancelled', data: {} }]);

      let capturedSignal: AbortSignal | undefined;
      let resolveRun!: () => void;
      const running = new Promise<void>(resolve => {
        resolveRun = resolve;
      });
      vi.spyOn(testJobInstance, 'run').mockImplementation(async (_payload, signal) => {
        capturedSignal = signal;
        await running;
      });

      runner.cancelPollIntervalSeconds = 1;
      await runner.start();

      const callbackPromise = getWorkerCallback()([{ id: 'job-1', data: { message: 'long' } } as unknown as PgJob<object>]);

      // Advance past one poll interval so the runner observes the cancellation.
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockPgBoss.findJobs).toHaveBeenCalledWith('test-job', { id: 'job-1' });
      expect(capturedSignal?.aborted).toBe(true);

      resolveRun();
      await callbackPromise;
    });

    it('aborts the signal when the job has been deleted while running', async () => {
      vi.useFakeTimers();
      mockPgBoss.findJobs = vi.fn().mockResolvedValue([]);

      let capturedSignal: AbortSignal | undefined;
      let resolveRun!: () => void;
      const running = new Promise<void>(resolve => {
        resolveRun = resolve;
      });
      vi.spyOn(testJobInstance, 'run').mockImplementation(async (_payload, signal) => {
        capturedSignal = signal;
        await running;
      });

      runner.cancelPollIntervalSeconds = 1;
      await runner.start();

      const callbackPromise = getWorkerCallback()([{ id: 'job-1', data: { message: 'long' } } as unknown as PgJob<object>]);
      await vi.advanceTimersByTimeAsync(1000);

      expect(capturedSignal?.aborted).toBe(true);

      resolveRun();
      await callbackPromise;
    });

    it('stops polling once the job finishes', async () => {
      vi.useFakeTimers();
      mockPgBoss.findJobs = vi.fn().mockResolvedValue([{ id: 'job-1', name: 'test-job', state: 'active', data: {} }]);
      vi.spyOn(testJobInstance, 'run').mockResolvedValue(undefined);

      runner.cancelPollIntervalSeconds = 1;
      await runner.start();

      await getWorkerCallback()([{ id: 'job-1', data: { message: 'quick' } } as unknown as PgJob<object>]);
      await vi.advanceTimersByTimeAsync(5000);

      // The worker cleared its poll timer in the finally block, so no lookups fire.
      expect(mockPgBoss.findJobs).not.toHaveBeenCalled();
    });

    it('does not poll when cancelPollIntervalSeconds is 0', async () => {
      vi.useFakeTimers();
      mockPgBoss.findJobs = vi.fn();

      let capturedSignal: AbortSignal | undefined;
      let resolveRun!: () => void;
      const running = new Promise<void>(resolve => {
        resolveRun = resolve;
      });
      vi.spyOn(testJobInstance, 'run').mockImplementation(async (_payload, signal) => {
        capturedSignal = signal;
        await running;
      });

      runner.cancelPollIntervalSeconds = 0;
      await runner.start();

      const callbackPromise = getWorkerCallback()([{ id: 'job-1', data: { message: 'long' } } as unknown as PgJob<object>]);
      await vi.advanceTimersByTimeAsync(60000);

      expect(mockPgBoss.findJobs).not.toHaveBeenCalled();
      expect(capturedSignal?.aborted).toBe(false);

      resolveRun();
      await callbackPromise;
    });

    it('runs a handler that ignores the signal to completion despite cancellation', async () => {
      // Documents the cooperative contract: cancellation is a request, not a kill.
      vi.useFakeTimers();
      mockPgBoss.findJobs = vi.fn().mockResolvedValue([{ id: 'job-1', name: 'test-job', state: 'cancelled', data: {} }]);

      let completed = false;
      vi.spyOn(testJobInstance, 'run').mockImplementation(async () => {
        // Intentionally never checks the signal.
        completed = true;
      });

      runner.cancelPollIntervalSeconds = 1;
      await runner.start();

      await getWorkerCallback()([{ id: 'job-1', data: { message: 'stubborn' } } as unknown as PgJob<object>]);
      await vi.advanceTimersByTimeAsync(2000);

      expect(completed).toBe(true);
    });
  });

  describe('stop', () => {
    it('should stop pgboss instance', async () => {
      await runner.stop();

      expect(mockPgBoss.stop).toHaveBeenCalledOnce();
    });

    it('should handle stop being called multiple times', async () => {
      await runner.stop();
      await runner.stop();

      expect(mockPgBoss.stop).toHaveBeenCalledTimes(2);
    });
  });

  describe('empty registrations', () => {
    it('should handle empty registry gracefully', async () => {
      registrations.clear();
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.getQueue).not.toHaveBeenCalled();
      expect(mockPgBoss.createQueue).not.toHaveBeenCalled();
      expect(mockPgBoss.work).not.toHaveBeenCalled();
    });
  });

  describe('queue policy', () => {
    it('creates the queue with the name only when no policy is declared (backward compatible)', async () => {
      await runner.start();

      // The single-argument form must be preserved so existing callers are unaffected.
      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('test-job');
      expect(mockPgBoss.updateQueue).not.toHaveBeenCalled();
    });

    it('creates an absent queue with mapped pg-boss options when a policy is declared', async () => {
      registrations.clear();
      registrations.set('charge.webhook', {
        job: TestJob,
        policy: {
          retryLimit: 5,
          retryDelay: Duration.fromObject({ seconds: 30 }),
          retryBackoff: true,
          retryDelayMax: Duration.fromObject({ minutes: 10 }),
          expiresIn: Duration.fromObject({ minutes: 2 }),
        },
      });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('charge.webhook', {
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        retryDelayMax: 600,
        expireInSeconds: 120,
      });
      expect(mockPgBoss.updateQueue).not.toHaveBeenCalled();
    });

    it('updates an existing queue with the policy instead of recreating it', async () => {
      vi.mocked(mockPgBoss.getQueue).mockResolvedValue({ name: 'test-job' } as unknown as Awaited<ReturnType<PgBoss['getQueue']>>);

      registrations.clear();
      registrations.set('test-job', { job: TestJob, policy: { retryLimit: 3 } });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.createQueue).not.toHaveBeenCalled();
      expect(mockPgBoss.updateQueue).toHaveBeenCalledWith('test-job', { retryLimit: 3 });
    });

    it('rounds sub-second Duration values to whole seconds', async () => {
      registrations.clear();
      registrations.set('rounding-job', {
        job: TestJob,
        policy: { retryDelay: Duration.fromObject({ milliseconds: 1500 }) },
      });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('rounding-job', { retryDelay: 2 });
    });

    it('merges defaultQueuePolicy beneath each queue policy, letting the queue override fields', async () => {
      registrations.clear();
      registrations.set('overrides', { job: TestJob, policy: { retryLimit: 10 } });
      registrations.set('defaults-only', TestJob);
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);
      runner.defaultQueuePolicy = { retryLimit: 2, retryBackoff: true };

      await runner.start();

      // Own policy wins for retryLimit; the default's retryBackoff still applies.
      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('overrides', { retryLimit: 10, retryBackoff: true });
      // A queue with no policy of its own still receives the runner-wide default.
      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('defaults-only', { retryLimit: 2, retryBackoff: true });
    });

    it('applies the policy to on-demand jobs without scheduling them', async () => {
      registrations.clear();
      registrations.set('on-demand', { job: TestJob, policy: { retryLimit: 4 } });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('on-demand', { retryLimit: 4 });
      expect(mockPgBoss.schedule).not.toHaveBeenCalled();
    });

    it('applies the policy to scheduled jobs alongside the cron schedule', async () => {
      registrations.clear();
      registrations.set('nightly', { job: TestJob, cron: '0 0 * * *', policy: { retryLimit: 1 } });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('nightly', { retryLimit: 1 });
      expect(mockPgBoss.schedule).toHaveBeenCalledWith('nightly', '0 0 * * *');
    });
  });

  describe('permanent failures', () => {
    it('dead-letters a job that throws PermanentJobError instead of failing it', async () => {
      const permanent = new PermanentJobError('malformed payload');
      vi.spyOn(testJobInstance, 'run').mockRejectedValue(permanent);

      await runner.start();

      // `deadletter` skips the queue's remaining retries — nothing about waiting makes a
      // malformed payload parse.
      await expect(getWorkerCallback()([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>])).resolves.toEqual([
        { id: 'job-1', status: 'deadletter', output: permanent },
      ]);
    });

    it('discriminates permanent from transient failures within one batch', async () => {
      const permanent = new PermanentJobError('malformed payload');
      const transient = new Error('upstream timed out');
      let callCount = 0;
      vi.spyOn(testJobInstance, 'run').mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) throw permanent;
        if (callCount === 2) throw transient;
      });

      await runner.start();

      await expect(
        getWorkerCallback()([
          { id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>,
          { id: 'job-2', data: { message: 'b' } } as unknown as PgJob<object>,
          { id: 'job-3', data: { message: 'c' } } as unknown as PgJob<object>,
        ]),
      ).resolves.toEqual([
        { id: 'job-1', status: 'deadletter', output: permanent },
        { id: 'job-2', status: 'failed', output: transient },
        { id: 'job-3', status: 'completed' },
      ]);
    });

    it('dead-letters a subclass of PermanentJobError', async () => {
      class UnprocessablePayloadError extends PermanentJobError {}
      const permanent = new UnprocessablePayloadError('nope');
      vi.spyOn(testJobInstance, 'run').mockRejectedValue(permanent);

      await runner.start();

      await expect(getWorkerCallback()([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>])).resolves.toEqual([
        { id: 'job-1', status: 'deadletter', output: permanent },
      ]);
    });

    it('does not dead-letter an unrelated ServerkitError', async () => {
      // Only PermanentJobError declares a failure permanent; every other error stays
      // retryable, including other members of the ServerkitError family.
      const other = new ServerkitError('something went wrong');
      vi.spyOn(testJobInstance, 'run').mockRejectedValue(other);

      await runner.start();

      await expect(getWorkerCallback()([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>])).resolves.toEqual([
        { id: 'job-1', status: 'failed', output: other },
      ]);
    });

    it('does not dead-letter a transient error merely wrapped by a permanent cause', async () => {
      // The runner matches with a direct instanceof and never walks the cause chain, so
      // the meaning stays "this handler declared the failure permanent".
      const wrapped = new Error('transient', { cause: new PermanentJobError('inner') });
      vi.spyOn(testJobInstance, 'run').mockRejectedValue(wrapped);

      await runner.start();

      await expect(getWorkerCallback()([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>])).resolves.toEqual([
        { id: 'job-1', status: 'failed', output: wrapped },
      ]);
    });
  });

  describe('batch dispositions', () => {
    it('returns exactly one disposition per job, keyed by the job id', async () => {
      // pg-boss matches dispositions by id and fails any job the handler omits, so an
      // off-by-one here would silently turn a completed job into a retry.
      await runner.start();

      const jobs = Array.from({ length: 5 }, (_, i) => ({ id: `job-${i}`, data: { message: `${i}` } }) as unknown as PgJob<object>);
      const results = await getWorkerCallback()(jobs);

      expect(results.map(result => result.id)).toEqual(['job-0', 'job-1', 'job-2', 'job-3', 'job-4']);
      expect(results).toHaveLength(jobs.length);
    });

    it('records no output for a job that succeeded', async () => {
      await runner.start();

      const [result] = await getWorkerCallback()([{ id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>]);

      expect(result).toEqual({ id: 'job-1', status: 'completed' });
      expect(result).not.toHaveProperty('output');
    });
  });

  describe('worker policy', () => {
    it('registers the worker with perJobResults alone when no policy is declared', async () => {
      await runner.start();

      // `perJobResults` is unconditional — it is what makes pg-boss settle each job in a
      // batch individually — so a queue with no policy still gets an options object, and
      // nothing else in it.
      expect(mockPgBoss.work).toHaveBeenCalledWith('test-job', { perJobResults: true }, expect.any(Function));
    });

    it('registers the worker with mapped pg-boss options when a policy is declared', async () => {
      registrations.clear();
      registrations.set('image.thumbnail', {
        job: TestJob,
        worker: { concurrency: 8, batchSize: 4, pollInterval: Duration.fromObject({ seconds: 1 }) },
      });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.work).toHaveBeenCalledWith(
        'image.thumbnail',
        { perJobResults: true, localConcurrency: 8, batchSize: 4, pollingIntervalSeconds: 1 },
        expect.any(Function),
      );
    });

    it('passes pollInterval as fractional seconds rather than rounding it', async () => {
      // pg-boss accepts intervals down to 0.5s, so rounding would reject the value.
      registrations.clear();
      registrations.set('hot.queue', { job: TestJob, worker: { pollInterval: Duration.fromObject({ milliseconds: 500 }) } });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.work).toHaveBeenCalledWith('hot.queue', { perJobResults: true, pollingIntervalSeconds: 0.5 }, expect.any(Function));
    });

    it('merges defaultWorkerPolicy beneath each queue worker policy, letting the queue override fields', async () => {
      registrations.clear();
      registrations.set('overrides', { job: TestJob, worker: { concurrency: 10 } });
      registrations.set('defaults-only', TestJob);
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);
      runner.defaultWorkerPolicy = { concurrency: 2, batchSize: 5 };

      await runner.start();

      // Own policy wins for concurrency; the default's batchSize still applies.
      expect(mockPgBoss.work).toHaveBeenCalledWith('overrides', { perJobResults: true, localConcurrency: 10, batchSize: 5 }, expect.any(Function));
      // A queue with no policy of its own still receives the runner-wide default.
      expect(mockPgBoss.work).toHaveBeenCalledWith('defaults-only', { perJobResults: true, localConcurrency: 2, batchSize: 5 }, expect.any(Function));
    });

    it('maps an empty worker policy to perJobResults alone', async () => {
      registrations.clear();
      registrations.set('empty.policy', { job: TestJob, worker: {} });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.work).toHaveBeenCalledWith('empty.policy', { perJobResults: true }, expect.any(Function));
    });

    it('is independent of the queue policy', async () => {
      // A queue policy configures the queue; a worker policy configures this node's
      // worker. Declaring one must not imply the other.
      registrations.clear();
      registrations.set('queue.only', { job: TestJob, policy: { retryLimit: 3 } });
      registrations.set('worker.only', { job: TestJob, worker: { concurrency: 3 } });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('queue.only', { retryLimit: 3 });
      expect(mockPgBoss.work).toHaveBeenCalledWith('queue.only', { perJobResults: true }, expect.any(Function));

      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('worker.only');
      expect(mockPgBoss.work).toHaveBeenCalledWith('worker.only', { perJobResults: true, localConcurrency: 3 }, expect.any(Function));
    });

    it('applies the worker policy to scheduled jobs alongside the cron schedule', async () => {
      registrations.clear();
      registrations.set('nightly', { job: TestJob, cron: '0 0 * * *', worker: { concurrency: 2 } });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      expect(mockPgBoss.work).toHaveBeenCalledWith('nightly', { perJobResults: true, localConcurrency: 2 }, expect.any(Function));
      expect(mockPgBoss.schedule).toHaveBeenCalledWith('nightly', '0 0 * * *');
    });
  });

  describe('dead-letter queues', () => {
    it('auto-creates a referenced dead-letter queue that does not yet exist, before the source queue', async () => {
      registrations.clear();
      registrations.set('charge.webhook', { job: TestJob, policy: { retryLimit: 5, deadLetter: 'charge.webhook.dead' } });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      // The DLQ is created as a plain queue, and before the queue that references it.
      const created = vi.mocked(mockPgBoss.createQueue).mock.calls.map(call => call[0]);
      expect(created).toEqual(['charge.webhook.dead', 'charge.webhook']);
      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('charge.webhook.dead');
      expect(mockPgBoss.createQueue).toHaveBeenCalledWith('charge.webhook', { retryLimit: 5, deadLetter: 'charge.webhook.dead' });
    });

    it('does not recreate a dead-letter queue that already exists', async () => {
      vi.mocked(mockPgBoss.getQueue).mockImplementation(async (name: string) =>
        name === 'charge.webhook.dead' ? ({ name } as unknown as Awaited<ReturnType<PgBoss['getQueue']>>) : null,
      );

      registrations.clear();
      registrations.set('charge.webhook', { job: TestJob, policy: { deadLetter: 'charge.webhook.dead' } });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      const created = vi.mocked(mockPgBoss.createQueue).mock.calls.map(call => call[0]);
      expect(created).not.toContain('charge.webhook.dead');
      expect(created).toContain('charge.webhook');
    });

    it('creates a shared dead-letter queue only once across multiple source queues', async () => {
      registrations.clear();
      registrations.set('charge.webhook', { job: TestJob, policy: { deadLetter: 'money.dead' } });
      registrations.set('payout.webhook', { job: TestJob, policy: { deadLetter: 'money.dead' } });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      const dlqCreations = vi.mocked(mockPgBoss.createQueue).mock.calls.filter(call => call[0] === 'money.dead');
      expect(dlqCreations).toHaveLength(1);
    });
  });
});
