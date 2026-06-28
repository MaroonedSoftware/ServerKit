import { describe, it, expect } from 'vitest';
import { ServerkitError } from '@maroonedsoftware/errors';
import { StorageError, StorageObjectNotFoundError, StorageOperationNotSupportedError } from '../src/storage.errors.js';

describe('storage errors', () => {
  it('StorageError extends ServerkitError', () => {
    const error = new StorageError('boom');
    expect(error).toBeInstanceOf(ServerkitError);
    expect(error.name).toBe('StorageError');
  });

  it('StorageObjectNotFoundError carries the key and extends StorageError', () => {
    const error = new StorageObjectNotFoundError('users/42/avatar.png');
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toBeInstanceOf(ServerkitError);
    expect(error.key).toBe('users/42/avatar.png');
    expect(error.message).toContain('users/42/avatar.png');
  });

  it('StorageOperationNotSupportedError names the operation', () => {
    const error = new StorageOperationNotSupportedError('getSignedUrl');
    expect(error).toBeInstanceOf(StorageError);
    expect(error.message).toContain('getSignedUrl');
  });
});
