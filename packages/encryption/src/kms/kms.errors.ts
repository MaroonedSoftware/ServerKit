import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Base class for all errors thrown by a {@link KmsProvider}.
 *
 * Catch this to handle any KMS failure generically; catch a subclass to
 * distinguish specific conditions (missing key, retired key, upstream outage).
 */
export class KmsError extends ServerkitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KmsError';
  }
}

/**
 * Thrown when the underlying KMS backend (e.g. AWS KMS, GCP KMS) is
 * unreachable or returns a transient error. Callers may choose to retry
 * or fall back to a degraded mode.
 */
export class KmsOutageError extends KmsError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KmsOutageError';
  }
}

/**
 * Thrown when a decrypt is attempted against a key that has been fully
 * retired. Retired keys remain in storage for audit purposes but can no
 * longer be used to decrypt.
 *
 * Note: keys in the `retiring` state can still decrypt — this error only
 * fires for the terminal `retired` state.
 */
export class KeyRetiredError extends KmsError {
  constructor(keyId: string) {
    super(`key ${keyId} is retired and cannot decrypt`);
    this.name = 'KeyRetiredError';
  }
}

/**
 * Thrown when a decrypt references a `keyId` the provider has no record of.
 * Usually indicates the ciphertext was produced by a different provider
 * instance or the key has been purged.
 */
export class KeyNotFoundError extends KmsError {
  constructor(keyId: string) {
    super(`key ${keyId} not found`);
    this.name = 'KeyNotFoundError';
  }
}
