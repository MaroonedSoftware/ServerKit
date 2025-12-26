import { Injectable } from 'injectkit';

/**
 * Abstract base class for job runner implementations.
 *
 * A job runner is responsible for consuming jobs from the queue and
 * executing the appropriate job handlers. It manages the worker lifecycle
 * and provides the consumer-side interface for the job processing system.
 *
 * @example
 * ```typescript
 * // Start processing jobs
 * await jobRunner.start();
 *
 * // Gracefully stop processing (e.g., on shutdown)
 * process.on('SIGTERM', async () => {
 *   await jobRunner.stop();
 *   process.exit(0);
 * });
 * ```
 */
@Injectable()
export abstract class JobRunner {
  /**
   * Starts the job runner and begins processing jobs.
   *
   * This method initializes all registered job handlers and starts
   * listening for jobs on their respective queues. It should be called
   * during application startup.
   *
   * @returns A promise that resolves when the runner has started successfully.
   */
  abstract start(): Promise<void>;

  /**
   * Stops the job runner gracefully.
   *
   * This method stops accepting new jobs and waits for currently
   * executing jobs to complete. It should be called during application
   * shutdown to ensure clean termination.
   *
   * @returns A promise that resolves when the runner has stopped completely.
   */
  abstract stop(): Promise<void>;
}
