import { Job } from '@maroonedsoftware/jobbroker';
import type { PgBossJobRegistration } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';

/**
 * Removes expired sessions on a schedule.
 *
 * A `cron` registration schedules the job with no payload, so a job driven that way takes what it
 * needs from its constructor and does not read `payload`. To schedule with a payload, leave out
 * `cron` and call JobBroker.schedule(name, cron, payload) after the runner has started.
 */
@Injectable()
export class CleanupExpiredSessionsJob extends Job {
  constructor(private readonly logger: Logger) {
    super();
  }

  async run(_payload: object, signal?: AbortSignal): Promise<void> {
    const cutoff = DateTime.utc().minus({ hours: 24 });

    this.logger.info('Starting session cleanup', { cutoff: cutoff.toISO() });

    // Check the signal between batches, so a long run can stop when cancelled.
    // while (!signal?.aborted && (await sessions.deleteExpiredBatch(cutoff)) > 0) {}
    signal?.throwIfAborted();
  }
}

/**
 * The entry for PgBossJobRegistryMap, inside the module's setup hook:
 *
 * jobs.set('sessions.cleanup.expired', cleanupExpiredSessions);
 * registry.register(CleanupExpiredSessionsJob).useClass(CleanupExpiredSessionsJob).asScoped();
 */
export const cleanupExpiredSessions: PgBossJobRegistration = {
  job: CleanupExpiredSessionsJob,
  cron: '0 2 * * *', // Every day at 02:00.
  // How the queue retries, and where a job goes when it runs out of retries.
  policy: {
    retryLimit: 3,
    retryDelay: Duration.fromObject({ minutes: 5 }),
    retryBackoff: true,
    deadLetter: 'sessions.cleanup.expired.dead',
  },
  // How this process polls the queue.
  worker: { concurrency: 1 },
};

// Common cron patterns:
// - '*/15 * * * *'  Every 15 minutes
// - '0 * * * *'     Every hour
// - '0 0 * * *'     Every day at midnight
// - '0 0 * * 0'     Every Sunday at midnight
// - '0 0 1 * *'     First day of every month at midnight
