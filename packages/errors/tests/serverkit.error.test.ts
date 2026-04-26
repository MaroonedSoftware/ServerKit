import { describe, it, expect } from 'vitest';
import { ServerkitError, IsServerkitError } from '../src/serverkit.error.js';
import { HttpError } from '../src/http/http.error.js';

describe('ServerkitError', () => {
  describe('constructor', () => {
    it('preserves the message and is an instance of ServerkitError and Error', () => {
      const error = new ServerkitError('something broke');

      expect(error).toBeInstanceOf(ServerkitError);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('something broke');
    });

    it('preserves the prototype chain (workaround for built-in Error subclassing)', () => {
      const error = new ServerkitError('x');
      expect(Object.getPrototypeOf(error)).toBe(ServerkitError.prototype);
    });

    it('sets Symbol.toStringTag to Object so JSON.stringify of {error} does not collapse to {}', () => {
      const error = new ServerkitError('x');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as any)[Symbol.toStringTag]).toBe('Object');
    });
  });

  describe('withDetails', () => {
    it('sets details and returns the instance for chaining', () => {
      const error = new ServerkitError('bad input');
      const details = { email: 'invalid format' };

      const result = error.withDetails(details);

      expect(result).toBe(error);
      expect(error.details).toEqual(details);
    });

    it('overwrites prior details when called again', () => {
      const error = new ServerkitError('x').withDetails({ a: 1 }).withDetails({ b: 2 });
      expect(error.details).toEqual({ b: 2 });
    });
  });

  describe('withCause', () => {
    it('sets cause and returns the instance for chaining', () => {
      const root = new Error('original');
      const error = new ServerkitError('wrapper');

      const result = error.withCause(root);

      expect(result).toBe(error);
      expect(error.cause).toBe(root);
    });
  });

  describe('withInternalDetails', () => {
    it('sets internalDetails and returns the instance for chaining', () => {
      const error = new ServerkitError('x');
      const internal = { userId: 42, requestId: 'req-1' };

      const result = error.withInternalDetails(internal);

      expect(result).toBe(error);
      expect(error.internalDetails).toEqual(internal);
    });
  });

  describe('chaining', () => {
    it('allows chaining all setters together', () => {
      const root = new Error('root');
      const error = new ServerkitError('wrapped')
        .withDetails({ field: 'invalid' })
        .withCause(root)
        .withInternalDetails({ trace: 'abc-123' });

      expect(error.details).toEqual({ field: 'invalid' });
      expect(error.cause).toBe(root);
      expect(error.internalDetails).toEqual({ trace: 'abc-123' });
    });
  });

  describe('subclassing', () => {
    class DomainError extends ServerkitError {}

    it('preserves the subclass prototype after construction', () => {
      const error = new DomainError('domain-specific');

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(ServerkitError);
      expect(error).toBeInstanceOf(Error);
    });

    it('inherits chainable setters from ServerkitError', () => {
      const error = new DomainError('domain-specific').withDetails({ resource: 'invoices' });

      expect(error.details).toEqual({ resource: 'invoices' });
      expect(error).toBeInstanceOf(DomainError);
    });
  });
});

describe('IsServerkitError', () => {
  it('returns true for ServerkitError instances', () => {
    expect(IsServerkitError(new ServerkitError('x'))).toBe(true);
  });

  it('returns true for HttpError instances (subclass)', () => {
    expect(IsServerkitError(new HttpError(404))).toBe(true);
  });

  it('returns true for instances of any ServerkitError subclass', () => {
    class CustomError extends ServerkitError {}
    expect(IsServerkitError(new CustomError('x'))).toBe(true);
  });

  it('returns false for plain Error instances', () => {
    expect(IsServerkitError(new Error('plain'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(IsServerkitError(null)).toBe(false);
    expect(IsServerkitError(undefined)).toBe(false);
    expect(IsServerkitError('string')).toBe(false);
    expect(IsServerkitError(42)).toBe(false);
    expect(IsServerkitError({})).toBe(false);
  });

  it('narrows the type so details/cause/internalDetails are accessible', () => {
    const error: unknown = new ServerkitError('x').withDetails({ a: 1 });
    if (IsServerkitError(error)) {
      expect(error.details).toEqual({ a: 1 });
    }
  });
});
