import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Db, PgBoss } from 'pg-boss';
import { PgBossJobBroker } from '../../src/pgboss/pgboss.job.broker.js';
import { PgBossJobRegistryMap } from '../../src/pgboss/pgboss.job.registration.js';
import { PgBossConnectionProvider } from '../../src/pgboss/pgboss.connection.provider.js';
import { Job } from '../../src/job.js';

class TestJob extends Job<{ message: string }> {
  async run(payload: { message: string }): Promise<void> {
    console.log(payload.message);
  }
}

describe('PgBossJobBroker', () => {
  let mockPgBoss: PgBoss;
  let registrations: PgBossJobRegistryMap;
  let connectionProvider: PgBossConnectionProvider;
  let broker: PgBossJobBroker;

  beforeEach(() => {
    mockPgBoss = {
      send: vi.fn().mockResolvedValue('job-id'),
      schedule: vi.fn().mockResolvedValue(undefined),
      unschedule: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue({ updated: 1 }),
      resume: vi.fn().mockResolvedValue({ updated: 1 }),
      deleteJob: vi.fn().mockResolvedValue({ updated: 1 }),
      findJobs: vi.fn().mockResolvedValue([]),
    } as unknown as PgBoss;

    registrations = new PgBossJobRegistryMap();
    registrations.set('test-job', TestJob);

    connectionProvider = new PgBossConnectionProvider();

    broker = new PgBossJobBroker(registrations, mockPgBoss, connectionProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('send', () => {
    it('should send a job with payload when job is registered and return its id', async () => {
      const payload = { message: 'Hello, World!' };

      const id = await broker.send('test-job', payload);

      expect(id).toBe('job-id');
      expect(mockPgBoss.send).toHaveBeenCalledOnce();
      expect(mockPgBoss.send).toHaveBeenCalledWith('test-job', payload, { db: undefined });
    });

    it('should throw when pg-boss does not return a job id', async () => {
      vi.mocked(mockPgBoss.send).mockResolvedValueOnce(null);

      await expect(broker.send('test-job', { message: 'dropped' })).rejects.toThrow('Failed to enqueue job test-job');
    });

    it('should throw an error when job is not registered', async () => {
      const payload = { data: 'test' };

      await expect(broker.send('unregistered-job', payload)).rejects.toThrow('Job unregistered-job is not registered');
      expect(mockPgBoss.send).not.toHaveBeenCalled();
    });

    it('should handle empty payload', async () => {
      const payload = {};

      await broker.send('test-job', payload);

      expect(mockPgBoss.send).toHaveBeenCalledWith('test-job', payload, { db: undefined });
    });

    it('should handle complex payload objects', async () => {
      const payload = {
        nested: { deep: { value: 'test' } },
        array: [1, 2, 3],
        number: 42,
        boolean: true,
      };

      await broker.send('test-job', payload);

      expect(mockPgBoss.send).toHaveBeenCalledWith('test-job', payload, { db: undefined });
    });

    it('should enqueue on the executor supplied by the connection provider', async () => {
      const transactionalDb = { executeSql: vi.fn() } as unknown as Db;
      vi.spyOn(connectionProvider, 'executor').mockReturnValue(transactionalDb);

      await broker.send('test-job', { message: 'tx' });

      expect(mockPgBoss.send).toHaveBeenCalledWith('test-job', { message: 'tx' }, { db: transactionalDb });
    });
  });

  describe('schedule', () => {
    it('should schedule a job with cron expression when job is registered', async () => {
      const cron = '0 0 * * *';
      const payload = { message: 'Scheduled task' };

      await broker.schedule('test-job', cron, payload);

      expect(mockPgBoss.schedule).toHaveBeenCalledOnce();
      expect(mockPgBoss.schedule).toHaveBeenCalledWith('test-job', cron, payload, { db: undefined });
    });

    it('should schedule a job without payload', async () => {
      const cron = '*/5 * * * *';

      await broker.schedule('test-job', cron);

      expect(mockPgBoss.schedule).toHaveBeenCalledWith('test-job', cron, undefined, { db: undefined });
    });

    it('should throw an error when job is not registered', async () => {
      const cron = '0 0 * * *';

      await expect(broker.schedule('unregistered-job', cron)).rejects.toThrow('Job unregistered-job is not registered');
      expect(mockPgBoss.schedule).not.toHaveBeenCalled();
    });

    it('should handle various cron expressions', async () => {
      const cronExpressions = [
        '* * * * *', // Every minute
        '0 * * * *', // Every hour
        '0 0 * * *', // Every day at midnight
        '0 0 * * 0', // Every Sunday at midnight
        '0 0 1 * *', // First day of every month
      ];

      for (const cron of cronExpressions) {
        await broker.schedule('test-job', cron);
      }

      expect(mockPgBoss.schedule).toHaveBeenCalledTimes(cronExpressions.length);
    });

    it('should schedule on the executor supplied by the connection provider', async () => {
      const transactionalDb = { executeSql: vi.fn() } as unknown as Db;
      vi.spyOn(connectionProvider, 'executor').mockReturnValue(transactionalDb);

      await broker.schedule('test-job', '0 0 * * *');

      expect(mockPgBoss.schedule).toHaveBeenCalledWith('test-job', '0 0 * * *', undefined, { db: transactionalDb });
    });
  });

  describe('unschedule', () => {
    it('should unschedule a job when job is registered', async () => {
      await broker.unschedule('test-job');

      expect(mockPgBoss.unschedule).toHaveBeenCalledOnce();
      expect(mockPgBoss.unschedule).toHaveBeenCalledWith('test-job');
    });

    it('should throw an error when job is not registered', async () => {
      await expect(broker.unschedule('unregistered-job')).rejects.toThrow('Job unregistered-job is not registered');
      expect(mockPgBoss.unschedule).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should cancel a job by id when registered', async () => {
      await broker.cancel('test-job', 'job-id');

      expect(mockPgBoss.cancel).toHaveBeenCalledOnce();
      expect(mockPgBoss.cancel).toHaveBeenCalledWith('test-job', 'job-id', { db: undefined });
    });

    it('should cancel multiple jobs by id array', async () => {
      await broker.cancel('test-job', ['a', 'b']);

      expect(mockPgBoss.cancel).toHaveBeenCalledWith('test-job', ['a', 'b'], { db: undefined });
    });

    it('should cancel on the executor supplied by the connection provider', async () => {
      const transactionalDb = { executeSql: vi.fn() } as unknown as Db;
      vi.spyOn(connectionProvider, 'executor').mockReturnValue(transactionalDb);

      await broker.cancel('test-job', 'job-id');

      expect(mockPgBoss.cancel).toHaveBeenCalledWith('test-job', 'job-id', { db: transactionalDb });
    });

    it('should throw an error when job is not registered', async () => {
      await expect(broker.cancel('unregistered-job', 'job-id')).rejects.toThrow('Job unregistered-job is not registered');
      expect(mockPgBoss.cancel).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('should resume a job by id when registered', async () => {
      await broker.resume('test-job', 'job-id');

      expect(mockPgBoss.resume).toHaveBeenCalledOnce();
      expect(mockPgBoss.resume).toHaveBeenCalledWith('test-job', 'job-id', { db: undefined });
    });

    it('should throw an error when job is not registered', async () => {
      await expect(broker.resume('unregistered-job', 'job-id')).rejects.toThrow('Job unregistered-job is not registered');
      expect(mockPgBoss.resume).not.toHaveBeenCalled();
    });
  });

  describe('deleteJob', () => {
    it('should delete a job by id when registered', async () => {
      await broker.deleteJob('test-job', 'job-id');

      expect(mockPgBoss.deleteJob).toHaveBeenCalledOnce();
      expect(mockPgBoss.deleteJob).toHaveBeenCalledWith('test-job', 'job-id', { db: undefined });
    });

    it('should throw an error when job is not registered', async () => {
      await expect(broker.deleteJob('unregistered-job', 'job-id')).rejects.toThrow('Job unregistered-job is not registered');
      expect(mockPgBoss.deleteJob).not.toHaveBeenCalled();
    });
  });

  describe('getJob', () => {
    it('should map a pg-boss job to JobInfo when found', async () => {
      vi.mocked(mockPgBoss.findJobs).mockResolvedValueOnce([
        {
          id: 'job-id',
          name: 'test-job',
          state: 'active',
          data: { message: 'hi' },
        },
      ] as unknown as Awaited<ReturnType<PgBoss['findJobs']>>);

      const info = await broker.getJob('test-job', 'job-id');

      expect(mockPgBoss.findJobs).toHaveBeenCalledWith('test-job', { id: 'job-id', db: undefined });
      expect(info).toEqual({ id: 'job-id', name: 'test-job', state: 'active', data: { message: 'hi' } });
    });

    it('should return null when the job does not exist', async () => {
      vi.mocked(mockPgBoss.findJobs).mockResolvedValueOnce([]);

      const info = await broker.getJob('test-job', 'missing');

      expect(info).toBeNull();
    });

    it('should throw an error when job is not registered', async () => {
      await expect(broker.getJob('unregistered-job', 'job-id')).rejects.toThrow('Job unregistered-job is not registered');
      expect(mockPgBoss.findJobs).not.toHaveBeenCalled();
    });
  });

  describe('multiple job registrations', () => {
    beforeEach(() => {
      registrations.set('job-1', TestJob);
      registrations.set('job-2', TestJob);
      registrations.set('job-3', TestJob);
    });

    it('should handle multiple registered jobs', async () => {
      await broker.send('job-1', { message: '1' });
      await broker.send('job-2', { message: '2' });
      await broker.send('job-3', { message: '3' });

      expect(mockPgBoss.send).toHaveBeenCalledTimes(3);
    });

    it('should still reject unregistered jobs among registered ones', async () => {
      await broker.send('job-1', { message: '1' });
      await expect(broker.send('job-not-registered', { message: 'fail' })).rejects.toThrow();
      await broker.send('job-2', { message: '2' });

      expect(mockPgBoss.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('job registration with cron configuration', () => {
    beforeEach(() => {
      registrations.set('cron-job', { job: TestJob, cron: '0 0 * * *' });
    });

    it('should recognize cron-configured job registrations for send', async () => {
      await broker.send('cron-job', { message: 'cron payload' });

      expect(mockPgBoss.send).toHaveBeenCalledWith('cron-job', { message: 'cron payload' }, { db: undefined });
    });

    it('should recognize cron-configured job registrations for schedule', async () => {
      await broker.schedule('cron-job', '*/10 * * * *');

      expect(mockPgBoss.schedule).toHaveBeenCalledWith('cron-job', '*/10 * * * *', undefined, { db: undefined });
    });

    it('should recognize cron-configured job registrations for unschedule', async () => {
      await broker.unschedule('cron-job');

      expect(mockPgBoss.unschedule).toHaveBeenCalledWith('cron-job');
    });
  });
});
