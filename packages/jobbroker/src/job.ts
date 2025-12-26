import { Injectable } from 'injectkit';

/**
 * Abstract base class for defining background jobs.
 *
 * Extend this class to create custom job handlers that can be executed
 * asynchronously by a {@link JobRunner}. Each job implementation defines
 * how to process a specific type of payload.
 *
 * @typeParam Payload - The type of data the job expects to receive.
 *                      Must be an object type. Defaults to `object`.
 *
 * @example
 * ```typescript
 * interface EmailPayload {
 *   to: string;
 *   subject: string;
 *   body: string;
 * }
 *
 * @Injectable()
 * class SendEmailJob extends Job<EmailPayload> {
 *   async run(payload: EmailPayload): Promise<void> {
 *     await emailService.send(payload.to, payload.subject, payload.body);
 *   }
 * }
 * ```
 */
@Injectable()
export abstract class Job<Payload extends object = object> {
  /**
   * Executes the job with the provided payload.
   *
   * This method is called by the job runner when a job is dequeued
   * and ready for processing. Implementations should contain the
   * business logic for handling the job.
   *
   * @param payload - The data required to execute the job.
   * @returns A promise that resolves when the job completes successfully.
   * @throws If the job fails, the error will be caught and logged by the runner.
   */
  abstract run(payload: Payload): Promise<void>;
}
