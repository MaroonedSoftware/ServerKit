import { describe, it, expect } from 'vitest';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER, resolveRequestIdentity } from '../src/request/request.identity.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestIdentity', () => {
  it('reads both ids from their headers', () => {
    const identity = resolveRequestIdentity({ [CORRELATION_ID_HEADER]: 'corr-1', [REQUEST_ID_HEADER]: 'req-1' });

    expect(identity).toEqual({ correlationId: 'corr-1', requestId: 'req-1' });
  });

  it('takes the first value of a repeated header', () => {
    const identity = resolveRequestIdentity({ [CORRELATION_ID_HEADER]: ['first', 'second'], [REQUEST_ID_HEADER]: ['a', 'b'] });

    expect(identity).toEqual({ correlationId: 'first', requestId: 'a' });
  });

  it('generates a uuid for each missing header', () => {
    const identity = resolveRequestIdentity({});

    expect(identity.correlationId).toMatch(UUID);
    expect(identity.requestId).toMatch(UUID);
    expect(identity.correlationId).not.toBe(identity.requestId);
  });

  it('generates a uuid for an empty repeated header', () => {
    const identity = resolveRequestIdentity({ [CORRELATION_ID_HEADER]: [] });

    expect(identity.correlationId).toMatch(UUID);
  });
});
