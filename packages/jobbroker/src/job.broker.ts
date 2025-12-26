import { Injectable } from 'injectkit';

/**
 * Abstract base class for job broker implementations.
 *
 * A job broker is responsible for sending jobs to a queue and managing
 * scheduled jobs. It provides the producer-side interface for the job
 * processing system.
 *
 * @example
 * ```typescript
 * // Sending a job immediately
 * await jobBroker.send('send-email', {
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   body: 'Thanks for signing up.'
 * });
 *
 * // Scheduling a recurring job with cron
 * await jobBroker.schedule('daily-report', '0 9 * * *', {
 *   reportType: 'sales'
 * });
 *
 * // Removing a scheduled job
 * await jobBroker.unschedule('daily-report');
 * ```
 */
@Injectable()
export abstract class JobBroker {
  /**
   * Sends a job to the queue for immediate processing.
   *
   * The job will be picked up by a worker as soon as one is available.
   *
   * @typeParam Payload - The type of the job payload. Must be an object.
   * @param name - The unique name identifying the job type.
   *               Must match a registered job handler.
   * @param payload - The data to pass to the job handler.
   * @returns A promise that resolves when the job has been queued.
   * @throws If the job name is not registered.
   */
  abstract send<Payload extends object>(name: string, payload: Payload): Promise<void>;

  /**
   * Schedules a recurring job using a cron expression.
   *
   * The job will be automatically enqueued according to the cron schedule.
   * If a schedule already exists for this job name, it will be updated.
   *
   * @typeParam Payload - The type of the job payload. Must be an object.
   * @param name - The unique name identifying the job type.
   *               Must match a registered job handler.
   * @param cron - A cron expression defining the schedule (e.g., '0 9 * * *' for daily at 9am).
   * @param payload - Optional data to pass to the job handler on each execution.
   * @returns A promise that resolves when the schedule has been created.
   * @throws If the job name is not registered.
   */
  abstract schedule<Payload extends object>(name: string, cron: string, payload?: Payload): Promise<void>;

  /**
   * Removes a scheduled job.
   *
   * Stops the recurring execution of the specified job.
   * Does not affect jobs that are already queued.
   *
   * @param name - The unique name of the scheduled job to remove.
   * @returns A promise that resolves when the schedule has been removed.
   * @throws If the job name is not registered.
   */
  abstract unschedule(name: string): Promise<void>;
}
