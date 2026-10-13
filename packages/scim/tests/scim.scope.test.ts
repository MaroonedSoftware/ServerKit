import { describe, expect, it } from 'vitest';
import { type AuthenticationSession, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { assertScimScope, hasScimScope } from '../src/scope/scim.scope.js';
import { IsScimError } from '../src/errors/scim.error.js';

const session = (scimScopes?: unknown): AuthenticationSession =>
  ({ sessionToken: 't', subject: 's', factors: [], claims: scimScopes === undefined ? {} : { scimScopes } }) as unknown as AuthenticationSession;

const thrown = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('hasScimScope', () => {
  it('grants a listed scope', () => {
    expect(hasScimScope(session(['scim:read']), 'scim:read')).toBe(true);
  });

  it('grants anything to the wildcard', () => {
    expect(hasScimScope(session(['*']), 'scim:write')).toBe(true);
  });

  it('denies an unlisted scope', () => {
    expect(hasScimScope(session(['scim:read']), 'scim:write')).toBe(false);
  });

  it('denies when scimScopes is missing or not an array', () => {
    expect(hasScimScope(session(), 'scim')).toBe(false);
    expect(hasScimScope(session('scim'), 'scim')).toBe(false);
    expect(hasScimScope(undefined, 'scim')).toBe(false);
  });
});

describe('assertScimScope', () => {
  it('passes when the scope is granted', () => {
    expect(() => assertScimScope(session(['scim']), 'scim')).not.toThrow();
  });

  it('throws 401 with a Bearer challenge for the invalid session', () => {
    const error = thrown(() => assertScimScope(invalidAuthenticationSession, 'scim'));
    expect(IsScimError(error)).toBe(true);
    if (!IsScimError(error)) return;
    expect(error.statusCode).toBe(401);
    expect(error.headers?.['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('throws 401 when there is no session at all', () => {
    const error = thrown(() => assertScimScope(undefined, 'scim'));
    expect(IsScimError(error) && error.statusCode).toBe(401);
  });

  it('throws 403 insufficientScope naming the scope', () => {
    const error = thrown(() => assertScimScope(session(['other']), 'scim:write'));
    expect(IsScimError(error)).toBe(true);
    if (!IsScimError(error)) return;
    expect(error.statusCode).toBe(403);
    expect(error.toScimBody()).toMatchObject({ scimType: 'insufficientScope', detail: 'Scope "scim:write" required' });
  });
});
