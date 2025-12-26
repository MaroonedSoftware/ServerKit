import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Job as PgJob, PgBoss } from 'pg-boss';
import { Container } from 'injectkit';
import { PgBossJobRunner } from '../../src/pgboss/pgboss.job.runner.js';
import { PgBossJobRegistryMap } from '../../src/pgboss/pgboss.job.registeration.js';
import { Job } from '../../src/job.js';
import { Logger } from '@maroonedsoftware/logger';

class TestJob extends Job<{ message: string }> {
  async run(payload: { message: string }): Promise<void> {
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
      getQueue: vi.fn().mockResolvedValue(null),
      createQueue: vi.fn().mockResolvedValue(undefined),
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
      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0];
      const workerCallback = workCall[1] as (jobs: PgJob<object>[]) => Promise<void>;

      const mockJobs: PgJob<object>[] = [{ id: 'job-1', data: { message: 'Hello' } } as unknown as PgJob<object>];

      await workerCallback(mockJobs);

      expect(mockContainer.get).toHaveBeenCalledWith(TestJob);
      expect(testJobInstance.run).toHaveBeenCalledWith({ message: 'Hello' });
    });

    it('should process multiple jobs', async () => {
      await runner.start();

      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0];
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

    it('should log error when job execution fails', async () => {
      const testError = new Error('Job failed');
      vi.spyOn(testJobInstance, 'run').mockRejectedValue(testError);

      await runner.start();

      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0];
      const workerCallback = workCall[1] as (jobs: PgJob<object>[]) => Promise<void>;

      const mockJobs: PgJob<object>[] = [{ id: 'job-1', data: { message: 'Hello' } } as unknown as PgJob<object>];

      await workerCallback(mockJobs);

      // Allow async catch to complete
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockLogger.error).toHaveBeenCalledWith(testError);
    });

    it('should continue processing other jobs when one fails', async () => {
      let callCount = 0;
      vi.spyOn(testJobInstance, 'run').mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Second job failed');
        }
      });

      await runner.start();

      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0];
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

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(testJobInstance.run).toHaveBeenCalledTimes(3);
    });

    it('should use correct job identifier from cron registration', async () => {
      registrations.clear();
      registrations.set('cron-job', { job: TestJob, cron: '0 0 * * *' });
      runner = new PgBossJobRunner(mockContainer, registrations, mockPgBoss, mockLogger);

      await runner.start();

      const workCall = vi.mocked(mockPgBoss.work).mock.calls[0];
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
});
