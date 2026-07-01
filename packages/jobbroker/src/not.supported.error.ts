import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Thrown by a {@link JobBroker} when a requested operation is not supported by
 * the underlying backend.
 *
 * Backends vary in what they can do: some queue implementations can cancel a
 * queued job but not look up its state, others cannot cancel individual jobs at
 * all. Rather than silently doing nothing (which hides bugs), a backend throws
 * this error from any capability it cannot honor.
 *
 * Extends {@link ServerkitError}, so `errorMiddleware` renders it (as a 500) and
 * the `withDetails` / `withCause` / `withInternalDetails` setters apply.
 *
 * The bundled pg-boss backend supports every operation and never throws this;
 * it exists as the shared vocabulary for future backends (e.g. SQS, Pub/Sub).
 *
 * @example
 * ```typescript
 * async cancel(): Promise<void> {
 *   throw new NotSupportedError('cancel', 'sqs');
 * }
 * ```
 */
export class NotSupportedError extends ServerkitError {
  /** The name of the operation that is not supported (e.g. `'cancel'`). */
  readonly operation: string;
  /** The backend that does not support the operation, when known (e.g. `'sqs'`). */
  readonly backend?: string;

  /**
   * Creates a new NotSupportedError.
   *
   * @param operation - The name of the unsupported operation.
   * @param backend - The backend that does not support it, if known.
   */
  constructor(operation: string, backend?: string) {
    super(
      backend
        ? `Operation "${operation}" is not supported by the ${backend} job broker`
        : `Operation "${operation}" is not supported by this job broker`,
    );
    this.name = 'NotSupportedError';
    this.operation = operation;
    this.backend = backend;
  }
}
