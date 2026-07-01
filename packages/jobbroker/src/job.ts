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
 *   async run(payload: EmailPayload, signal?: AbortSignal): Promise<void> {
 *     // Long-running work should honor the signal so the job can be cancelled.
 *     await emailService.send(payload.to, payload.subject, payload.body, { signal });
 *     if (signal?.aborted) return;
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
   * The optional `signal` is aborted when the job is cancelled (see
   * {@link JobBroker.cancel}) or when the runner shuts down. Cancellation is
   * cooperative: long-running handlers should forward `signal` to the async
   * operations they perform (fetch, database queries, etc.) or periodically
   * check `signal.aborted` and return early. A handler that ignores the signal
   * cannot be interrupted and will run to completion.
   *
   * @param payload - The data required to execute the job.
   * @param signal - An {@link AbortSignal} that fires when the job is cancelled
   *                 or the runner stops. Optional; handlers may ignore it.
   * @returns A promise that resolves when the job completes successfully.
   * @throws If the job fails, the error will be caught and logged by the runner.
   */
  abstract run(payload: Payload, signal?: AbortSignal): Promise<void>;
}
