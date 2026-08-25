import { describe, it, expect } from 'vitest';
import { ServerkitError } from '@maroonedsoftware/errors';
import { PermanentJobError } from '../src/permanent.job.error.js';

describe('PermanentJobError', () => {
  it('carries the message it was constructed with', () => {
    const error = new PermanentJobError('Malformed webhook payload');

    expect(error.message).toBe('Malformed webhook payload');
    expect(error.name).toBe('PermanentJobError');
  });

  it('is an instance of PermanentJobError, ServerkitError, and Error', () => {
    // The runner discriminates permanent from transient failures with a direct
    // `instanceof PermanentJobError`, so this is what makes dead-lettering work at all.
    const error = new PermanentJobError('nope');

    expect(error).toBeInstanceOf(PermanentJobError);
    expect(error).toBeInstanceOf(ServerkitError);
    expect(error).toBeInstanceOf(Error);
  });

  it('keeps instanceof working for a subclass', () => {
    // ServerkitError restores the prototype from `new.target`, so a subclass does not
    // have to repeat that itself. The runner dead-letters subclasses too.
    class UnprocessablePayloadError extends PermanentJobError {}
    const error = new UnprocessablePayloadError('bad input');

    expect(error).toBeInstanceOf(UnprocessablePayloadError);
    expect(error).toBeInstanceOf(PermanentJobError);
  });

  it('chains the ServerkitError setters', () => {
    // `details` is persisted as the job's output, which is what an operator reads when
    // draining the dead-letter queue.
    const cause = new Error('underlying');
    const error = new PermanentJobError('Malformed payload').withDetails({ field: 'url' }).withInternalDetails({ jobId: 'job-1' }).withCause(cause);

    expect(error.details).toEqual({ field: 'url' });
    expect(error.internalDetails).toEqual({ jobId: 'job-1' });
    expect(error.cause).toBe(cause);
  });

  it('does not make an ordinary ServerkitError permanent', () => {
    // Only this type declares a failure permanent; the rest of the family stays retryable.
    expect(new ServerkitError('something went wrong')).not.toBeInstanceOf(PermanentJobError);
  });
});
