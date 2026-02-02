import { Job } from '@maroonedsoftware/jobbroker';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';

interface CleanupExpiredSessionsJobPayload {
  olderThanHours: number;
}

/**
 * Cleanup Expired Sessions Job
 *
 * @description Removes expired sessions from the database on a schedule
 */
@Injectable()
export class CleanupExpiredSessionsJob extends Job<CleanupExpiredSessionsJobPayload> {
  constructor(private readonly logger: Logger) {
    super('cleanup-expired-sessions');
  }

  async run(payload: CleanupExpiredSessionsJobPayload): Promise<void> {
    this.logger.info('Starting session cleanup', {
      olderThanHours: payload.olderThanHours
    });

    try {
      const cutoffDate = new Date();
      cutoffDate.setHours(cutoffDate.getHours() - payload.olderThanHours);

      // TODO: Implement cleanup logic
      // const sessionRepo = this.container.get(SessionRepository);
      // const deletedCount = await sessionRepo.deleteExpired(cutoffDate);

      const deletedCount = 0; // Placeholder

      this.logger.info('Session cleanup completed', {
        deletedCount,
        cutoffDate: cutoffDate.toISOString()
      });
    } catch (error) {
      this.logger.error('Session cleanup failed', { error });
      throw error;
    }
  }
}

// Usage example for scheduled jobs:
//
// In your application bootstrap:
// import { JobBroker } from '@maroonedsoftware/jobbroker';
// import { CleanupExpiredSessionsJob } from './jobs/cleanup-expired-sessions.job';
//
// const jobBroker = new JobBroker({
//   connectionString: process.env.DATABASE_URL!,
//   schema: 'jobs'
// });
//
// const cleanupJob = container.get(CleanupExpiredSessionsJob);
// await jobBroker.register(cleanupJob);
//
// // Schedule to run every day at 2 AM
// await jobBroker.schedule('cleanup-expired-sessions', '0 2 * * *', {
//   olderThanHours: 24
// });
//
// await jobBroker.start();
//
// Common cron patterns:
// - '*/15 * * * *'  - Every 15 minutes
// - '0 * * * *'     - Every hour
// - '0 0 * * *'     - Every day at midnight
// - '0 2 * * *'     - Every day at 2 AM
// - '0 0 * * 0'     - Every Sunday at midnight
// - '0 0 1 * *'     - First day of every month at midnight
