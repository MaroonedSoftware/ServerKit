import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Base class for all errors thrown by a {@link StorageProvider}.
 *
 * Catch this to handle any storage failure generically; catch a subclass to
 * distinguish specific conditions (missing object, unsupported operation).
 * Extends `ServerkitError`, so `errorMiddleware` renders it as a 500 with any
 * attached `details`.
 */
export class StorageError extends ServerkitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}

/**
 * Thrown when {@link StorageProvider.read} or {@link StorageProvider.stat} is
 * called for a key that does not exist. The offending key is available on
 * `key` for callers that want to surface it.
 */
export class StorageObjectNotFoundError extends StorageError {
  constructor(
    readonly key: string,
    options?: { cause?: unknown },
  ) {
    super(`storage object '${key}' not found`, options);
    this.name = 'StorageObjectNotFoundError';
  }
}

/**
 * Thrown when the backend rejects an operation for permission reasons (an S3 or
 * GCS `403`, a local-filesystem `EACCES`/`EPERM`). The offending key is
 * available on `key`.
 */
export class StorageAccessDeniedError extends StorageError {
  constructor(
    readonly key: string,
    options?: { cause?: unknown },
  ) {
    super(`access denied for storage object '${key}'`, options);
    this.name = 'StorageAccessDeniedError';
  }
}

/**
 * Thrown when an operation is not supported by the active backend — for
 * example {@link StorageProvider.getSignedUrl} on a disk provider that has no
 * public base URL configured.
 */
export class StorageOperationNotSupportedError extends StorageError {
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`storage operation '${operation}' is not supported by this backend`, options);
    this.name = 'StorageOperationNotSupportedError';
  }
}
