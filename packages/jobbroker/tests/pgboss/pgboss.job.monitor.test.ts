import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PgBoss } from 'pg-boss';
import { PgBossJobMonitor } from '../../src/pgboss/pgboss.job.monitor.js';
import { PgBossConnectionProvider } from '../../src/pgboss/pgboss.connection.provider.js';

describe('PgBossJobMonitor', () => {
  let mockPgBoss: PgBoss;
  let connectionProvider: PgBossConnectionProvider;
  let monitor: PgBossJobMonitor;

  beforeEach(() => {
    mockPgBoss = {
      getQueue: vi.fn().mockResolvedValue(null),
      findJobs: vi.fn().mockResolvedValue([]),
      redrive: vi.fn().mockResolvedValue(0),
      deleteJob: vi.fn().mockResolvedValue({ updated: 1 }),
      retry: vi.fn().mockResolvedValue({ updated: 1 }),
    } as unknown as PgBoss;

    connectionProvider = new PgBossConnectionProvider();

    monitor = new PgBossJobMonitor(mockPgBoss, connectionProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getQueueStats', () => {
    it('maps pg-boss queue counters onto the normalized stats shape', async () => {
      vi.mocked(mockPgBoss.getQueue).mockResolvedValue({
        name: 'charge.webhook.dead',
        queuedCount: 3,
        activeCount: 1,
        failedCount: 2,
        totalCount: 6,
      } as unknown as Awaited<ReturnType<PgBoss['getQueue']>>);

      const stats = await monitor.getQueueStats('charge.webhook.dead');

      expect(stats).toEqual({ name: 'charge.webhook.dead', queued: 3, active: 1, failed: 2, total: 6 });
    });

    it('returns null when the queue does not exist', async () => {
      vi.mocked(mockPgBoss.getQueue).mockResolvedValue(null);

      expect(await monitor.getQueueStats('missing')).toBeNull();
    });
  });

  describe('listJobs', () => {
    it('lists jobs in a queue mapped down to JobInfo, without requiring registration', async () => {
      vi.mocked(mockPgBoss.findJobs).mockResolvedValue([
        { id: 'a', name: 'charge.webhook.dead', state: 'created', data: { chargeId: 'c1' }, extra: 'ignored' },
        { id: 'b', name: 'charge.webhook.dead', state: 'created', data: { chargeId: 'c2' } },
      ] as unknown as Awaited<ReturnType<PgBoss['findJobs']>>);

      const jobs = await monitor.listJobs<{ chargeId: string }>('charge.webhook.dead');

      expect(jobs).toEqual([
        { id: 'a', name: 'charge.webhook.dead', state: 'created', data: { chargeId: 'c1' } },
        { id: 'b', name: 'charge.webhook.dead', state: 'created', data: { chargeId: 'c2' } },
      ]);
      expect(mockPgBoss.findJobs).toHaveBeenCalledWith('charge.webhook.dead', {
        id: undefined,
        data: undefined,
        queued: undefined,
        db: undefined,
      });
    });

    it('forwards id, data, and queuedOnly filters to pg-boss findJobs', async () => {
      await monitor.listJobs('charge.webhook.dead', { id: 'a', data: { chargeId: 'c1' }, queuedOnly: true });

      expect(mockPgBoss.findJobs).toHaveBeenCalledWith('charge.webhook.dead', {
        id: 'a',
        data: { chargeId: 'c1' },
        queued: true,
        db: undefined,
      });
    });

    it('returns an empty array when no jobs match', async () => {
      expect(await monitor.listJobs('charge.webhook.dead')).toEqual([]);
    });
  });

  describe('redrive', () => {
    it('redrives a dead-letter queue back to source and returns the count moved', async () => {
      vi.mocked(mockPgBoss.redrive).mockResolvedValue(42);

      const moved = await monitor.redrive('charge.webhook.dead', { limit: 100 });

      expect(moved).toBe(42);
      expect(mockPgBoss.redrive).toHaveBeenCalledWith('charge.webhook.dead', {
        destination: undefined,
        sourceName: undefined,
        limit: 100,
        db: undefined,
      });
    });

    it('forwards destination and sourceName for shared dead-letter queues', async () => {
      await monitor.redrive('money.dead', { destination: 'charge.webhook', sourceName: 'charge.webhook' });

      expect(mockPgBoss.redrive).toHaveBeenCalledWith('money.dead', {
        destination: 'charge.webhook',
        sourceName: 'charge.webhook',
        limit: undefined,
        db: undefined,
      });
    });
  });

  describe('deleteJob', () => {
    it('discards jobs from a queue via pg-boss deleteJob', async () => {
      await monitor.deleteJob('charge.webhook.dead', ['a', 'b']);

      expect(mockPgBoss.deleteJob).toHaveBeenCalledWith('charge.webhook.dead', ['a', 'b'], { db: undefined });
    });
  });

  describe('retryJob', () => {
    it('re-attempts jobs in place via pg-boss retry', async () => {
      await monitor.retryJob('charge.webhook', 'a');

      expect(mockPgBoss.retry).toHaveBeenCalledWith('charge.webhook', 'a', { db: undefined });
    });
  });

  describe('transactional executor', () => {
    it('sources the pg-boss db executor from the connection provider for every operation', async () => {
      const fakeExecutor = { executeSql: vi.fn() };
      vi.spyOn(connectionProvider, 'executor').mockReturnValue(fakeExecutor as never);

      await monitor.listJobs('charge.webhook.dead');
      await monitor.redrive('charge.webhook.dead');
      await monitor.deleteJob('charge.webhook.dead', 'a');
      await monitor.retryJob('charge.webhook', 'a');

      expect(mockPgBoss.findJobs).toHaveBeenCalledWith('charge.webhook.dead', expect.objectContaining({ db: fakeExecutor }));
      expect(mockPgBoss.redrive).toHaveBeenCalledWith('charge.webhook.dead', expect.objectContaining({ db: fakeExecutor }));
      expect(mockPgBoss.deleteJob).toHaveBeenCalledWith('charge.webhook.dead', 'a', { db: fakeExecutor });
      expect(mockPgBoss.retry).toHaveBeenCalledWith('charge.webhook', 'a', { db: fakeExecutor });
    });
  });
});
