import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PgBoss } from 'pg-boss';
import { PgBossJobBroker } from '../../src/pgboss/pgboss.job.broker.js';
import { PgBossJobRegistryMap } from '../../src/pgboss/pgboss.job.registeration.js';
import { Job } from '../../src/job.js';

class TestJob extends Job<{ message: string }> {
  async run(payload: { message: string }): Promise<void> {
    console.log(payload.message);
  }
}

describe('PgBossJobBroker', () => {
  let mockPgBoss: PgBoss;
  let registrations: PgBossJobRegistryMap;
  let broker: PgBossJobBroker;

  beforeEach(() => {
    mockPgBoss = {
      send: vi.fn().mockResolvedValue('job-id'),
      schedule: vi.fn().mockResolvedValue(undefined),
      unschedule: vi.fn().mockResolvedValue(undefined),
    } as unknown as PgBoss;

    registrations = new PgBossJobRegistryMap();
    registrations.set('test-job', TestJob);

    broker = new PgBossJobBroker(registrations, mockPgBoss);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('send', () => {
    it('should send a job with payload when job is registered', async () => {
      const payload = { message: 'Hello, World!' };

      await broker.send('test-job', payload);

      expect(mockPgBoss.send).toHaveBeenCalledOnce();
      expect(mockPgBoss.send).toHaveBeenCalledWith('test-job', payload);
    });

    it('should throw an error when job is not registered', async () => {
      const payload = { data: 'test' };

      await expect(broker.send('unregistered-job', payload)).rejects.toThrow('Job unregistered-job is not registered');
      expect(mockPgBoss.send).not.toHaveBeenCalled();
    });

    it('should handle empty payload', async () => {
      const payload = {};

      await broker.send('test-job', payload);

      expect(mockPgBoss.send).toHaveBeenCalledWith('test-job', payload);
    });

    it('should handle complex payload objects', async () => {
      const payload = {
        nested: { deep: { value: 'test' } },
        array: [1, 2, 3],
        number: 42,
        boolean: true,
      };

      await broker.send('test-job', payload);

      expect(mockPgBoss.send).toHaveBeenCalledWith('test-job', payload);
    });
  });

  describe('schedule', () => {
    it('should schedule a job with cron expression when job is registered', async () => {
      const cron = '0 0 * * *';
      const payload = { message: 'Scheduled task' };

      await broker.schedule('test-job', cron, payload);

      expect(mockPgBoss.schedule).toHaveBeenCalledOnce();
      expect(mockPgBoss.schedule).toHaveBeenCalledWith('test-job', cron, payload);
    });

    it('should schedule a job without payload', async () => {
      const cron = '*/5 * * * *';

      await broker.schedule('test-job', cron);

      expect(mockPgBoss.schedule).toHaveBeenCalledWith('test-job', cron, undefined);
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

      expect(mockPgBoss.send).toHaveBeenCalledWith('cron-job', {
        message: 'cron payload',
      });
    });

    it('should recognize cron-configured job registrations for schedule', async () => {
      await broker.schedule('cron-job', '*/10 * * * *');

      expect(mockPgBoss.schedule).toHaveBeenCalledWith('cron-job', '*/10 * * * *', undefined);
    });

    it('should recognize cron-configured job registrations for unschedule', async () => {
      await broker.unschedule('cron-job');

      expect(mockPgBoss.unschedule).toHaveBeenCalledWith('cron-job');
    });
  });
});
