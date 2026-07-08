import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Duration } from 'luxon';
import { Job as PgJob, PgBoss } from 'pg-boss';
import { Container } from 'injectkit';
import { PgBossJobRunner } from '../../src/pgboss/pgboss.job.runner.js';
import { PgBossJobRegistryMap } from '../../src/pgboss/pgboss.job.registration.js';
import { Job } from '../../src/job.js';
import { Logger } from '@maroonedsoftware/logger';

class TestJob extends Job<{ message: string }> {
  async run(payload: { message: string }, _signal?: AbortSignal): Promise<void> {
    console.log(payload.message);
  }
}

describe('PgBossJobRunner', () => {
  let mockPgBoss: PgBoss;
  let mockContainer: Container;
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

    mockContainer = {
      get: vi.fn().mockReturnValue(testJobInstance),
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
      expect(mockPgBoss.work).toHaveBeenCalledWith('test-job', expect.any(Function));
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
    it('should resolve job from container and execute run method', async () => {
      await runner.start();

      // Get the worker callback
      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0]!;
      const workerCallback = workCall[1] as (jobs: PgJob<object>[]) => Promise<void>;

      const mockJobs: PgJob<object>[] = [{ id: 'job-1', data: { message: 'Hello' } } as unknown as PgJob<object>];

      await workerCallback(mockJobs);

      expect(mockContainer.get).toHaveBeenCalledWith(TestJob);
      expect(testJobInstance.run).toHaveBeenCalledWith({ message: 'Hello' }, expect.any(AbortSignal));
    });

    it('should process multiple jobs', async () => {
      await runner.start();

      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0]!;
      const workerCallback = workCall[1] as (jobs: PgJob<object>[]) => Promise<void>;

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

    it('should log error and reject the work callback when job execution fails', async () => {
      const testError = new Error('Job failed');
      vi.spyOn(testJobInstance, 'run').mockRejectedValue(testError);

      await runner.start();

      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0]!;
      const workerCallback = workCall[1] as (jobs: PgJob<object>[]) => Promise<void>;

      const mockJobs: PgJob<object>[] = [{ id: 'job-1', data: { message: 'Hello' } } as unknown as PgJob<object>];

      // The callback must reject so pg-boss sees the failure (and applies retryLimit /
      // dead-lettering) rather than acking the batch as complete.
      await expect(workerCallback(mockJobs)).rejects.toBe(testError);

      expect(mockLogger.error).toHaveBeenCalledWith(testError);
    });

    it('should continue processing other jobs when one fails, then reject with an AggregateError only for the failures', async () => {
      let callCount = 0;
      const secondError = new Error('Second job failed');
      vi.spyOn(testJobInstance, 'run').mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw secondError;
        }
      });

      await runner.start();

      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0]!;
      const workerCallback = workCall[1] as (jobs: PgJob<object>[]) => Promise<void>;

      const mockJobs: PgJob<object>[] = [
        { id: 'job-1', data: { message: 'First' } } as unknown as PgJob<object>,
        {
          id: 'job-2',
          data: { message: 'Second' },
        } as unknown as PgJob<object>,
        { id: 'job-3', data: { message: 'Third' } } as unknown as PgJob<object>,
      ];

      // A single bad job does not stop its siblings (all three run), but the handler
      // still rejects so pg-boss retries the one that threw.
      await expect(workerCallback(mockJobs)).rejects.toBe(secondError);

      expect(testJobInstance.run).toHaveBeenCalledTimes(3);
    });

    it('rejects with an AggregateError of every failure when multiple jobs throw', async () => {
      const errors = [new Error('a failed'), new Error('b failed')];
      let callCount = 0;
      vi.spyOn(testJobInstance, 'run').mockImplementation(async () => {
        throw errors[callCount++]!;
      });

      await runner.start();

      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0]!;
      const workerCallback = workCall[1] as (jobs: PgJob<object>[]) => Promise<void>;

      const mockJobs: PgJob<object>[] = [
        { id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>,
        { id: 'job-2', data: { message: 'b' } } as unknown as PgJob<object>,
      ];

      await expect(workerCallback(mockJobs)).rejects.toBeInstanceOf(AggregateError);
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
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
      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0]!;
      const workerCallback = workCall[1] as (jobs: PgJob<object>[]) => Promise<void>;

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

    it('resolves a fresh job instance for each item in the batch', async () => {
      // The DI container may register the Job as transient; resolving once and
      // reusing the instance across concurrent jobs would corrupt per-instance state.
      await runner.start();
      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0]!;
      const workerCallback = workCall[1] as (jobs: PgJob<object>[]) => Promise<void>;

      vi.mocked(mockContainer.get).mockClear();

      await workerCallback([
        { id: 'job-1', data: { message: 'a' } } as unknown as PgJob<object>,
        { id: 'job-2', data: { message: 'b' } } as unknown as PgJob<object>,
        { id: 'job-3', data: { message: 'c' } } as unknown as PgJob<object>,
      ]);

      expect(mockContainer.get).toHaveBeenCalledTimes(3);
    });

    it('should use correct job identifier from cron registration', async () => {
      registrations.clear();
      registrations.set('cron-job', { job: TestJob, cron: '0 0 * * *' });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0]!;
      const workerCallback = workCall[1] as (jobs: PgJob<object>[]) => Promise<void>;

      const mockJobs: PgJob<object>[] = [
        {
          id: 'job-1',
          data: { message: 'Cron job' },
        } as unknown as PgJob<object>,
      ];

      await workerCallback(mockJobs);

      expect(mockContainer.get).toHaveBeenCalledWith(TestJob);
    });
  });

  describe('cooperative cancellation', () => {
    const getWorkerCallback = () => vi.mocked(mockPgBoss.work).mock.calls[0]![1] as (jobs: PgJob<object>[]) => Promise<void>;

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
