import { PgBoss } from 'pg-boss';
import { Injectable } from 'injectkit';
import { JobInfo } from '../job.info.js';
import { JobMonitor, JobQueryOptions, JobQueueStats, JobRedriveOptions } from '../job.monitor.js';
import { PgBossConnectionProvider } from './pgboss.connection.provider.js';

/**
 * pg-boss implementation of the {@link JobMonitor} interface.
 *
 * Provides the operator-side view of pg-boss queues — depth/health stats, job
 * enumeration, and dead-letter remediation (redrive, discard, retry) — on top of
 * pg-boss's native `getQueue`, `findJobs`, `redrive`, `deleteJob`, and `retry`.
 *
 * Like {@link PgBossJobBroker}, every operation sources its pg-boss `db` executor
 * from the injected {@link PgBossConnectionProvider}, so a remediation action can
 * participate in a surrounding transaction when a request-scoped override supplies
 * a transaction-bound executor. Unlike the broker, the monitor does not consult
 * the job registry: it works on any queue name, including an unregistered
 * dead-letter sink.
 *
 * @example
 * ```typescript
 * const monitor = new PgBossJobMonitor(pgboss, new PgBossConnectionProvider());
 *
 * const stats = await monitor.getQueueStats('charge.webhook.dead');
 * if (stats && stats.total > 0) {
 *   await monitor.redrive('charge.webhook.dead', { limit: 100 });
 * }
 * ```
 */
@Injectable()
export class PgBossJobMonitor extends JobMonitor {
  /**
   * Creates a new PgBossJobMonitor instance.
   *
   * @param pgboss - The pg-boss instance to use for queue operations.
   * @param connectionProvider - Supplies the pg-boss `db` executor for each
   *        operation; the default returns `undefined` (pg-boss's own pool),
   *        while a request-scoped override enables transactional remediation.
   */
  constructor(
    private readonly pgboss: PgBoss,
    private readonly connectionProvider: PgBossConnectionProvider,
  ) {
    super();
  }

  /**
   * Reports the depth and health of a queue by reading pg-boss's cached queue
   * counters.
   *
   * @param name - The queue name to inspect.
   * @returns The {@link JobQueueStats}, or `null` if the queue does not exist.
   */
  async getQueueStats(name: string): Promise<JobQueueStats | null> {
    const queue = await this.pgboss.getQueue(name);
    if (!queue) {
      return null;
    }

    return {
      name: queue.name,
      queued: queue.queuedCount,
      active: queue.activeCount,
      failed: queue.failedCount,
      total: queue.totalCount,
    };
  }

  /**
   * Lists jobs retained in a queue, mapping pg-boss's records down to the
   * backend-agnostic {@link JobInfo} shape.
   *
   * @typeParam Payload - The type of the job payloads.
   * @param name - The queue name to list.
   * @param options - Optional {@link JobQueryOptions} filters.
   * @returns The matching jobs (empty if none, or if the queue does not exist).
   */
  async listJobs<Payload extends object>(name: string, options?: JobQueryOptions): Promise<JobInfo<Payload>[]> {
    const jobs = await this.pgboss.findJobs<Payload>(name, {
      id: options?.id,
      data: options?.data,
      queued: options?.queuedOnly,
      db: this.connectionProvider.executor(),
    });

    return jobs.map(job => ({ id: job.id, name: job.name, state: job.state, data: job.data }));
  }

  /**
   * Moves dead-lettered jobs back into circulation via pg-boss `redrive`.
   *
   * @param name - The (dead-letter) queue to drain.
   * @param options - Optional {@link JobRedriveOptions}.
   * @returns The number of jobs moved.
   */
  async redrive(name: string, options?: JobRedriveOptions): Promise<number> {
    return this.pgboss.redrive(name, {
      destination: options?.destination,
      sourceName: options?.sourceName,
      limit: options?.limit,
      db: this.connectionProvider.executor(),
    });
  }

  /**
   * Permanently deletes one or more jobs from a queue.
   *
   * @param name - The queue name the jobs live in.
   * @param id - A single job id, or an array of ids, to delete.
   */
  async deleteJob(name: string, id: string | string[]): Promise<void> {
    await this.pgboss.deleteJob(name, id, { db: this.connectionProvider.executor() });
  }

  /**
   * Re-attempts one or more failed jobs in place via pg-boss `retry`.
   *
   * @param name - The queue name the jobs live in.
   * @param id - A single job id, or an array of ids, to retry.
   */
  async retryJob(name: string, id: string | string[]): Promise<void> {
    await this.pgboss.retry(name, id, { db: this.connectionProvider.executor() });
  }
}
