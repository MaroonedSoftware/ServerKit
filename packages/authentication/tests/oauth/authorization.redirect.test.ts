import { describe, expect, it } from 'vitest';
import { buildAuthorizationRedirect } from '../../src/oauth/authorization.redirect.js';

const ISS = 'https://station.example.com';

describe('buildAuthorizationRedirect', () => {
  it('carries the code, state, and issuer on success', () => {
    const url = new URL(buildAuthorizationRedirect('https://claude.ai/api/mcp/auth_callback', { code: 'c0de', state: 'st', iss: ISS }));

    expect(url.origin + url.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(Object.fromEntries(url.searchParams)).toEqual({ code: 'c0de', state: 'st', iss: ISS });
  });

  it('carries the error and the issuer on failure, without state when there was none', () => {
    const url = new URL(
      buildAuthorizationRedirect('http://localhost:53682/callback', { error: 'access_denied', error_description: 'the user said no', iss: ISS }),
    );

    expect(Object.fromEntries(url.searchParams)).toEqual({ error: 'access_denied', error_description: 'the user said no', iss: ISS });
    expect(url.port).toBe('53682');
  });

  it('keeps a query the redirect URI already had, and encodes values', () => {
    const url = new URL(buildAuthorizationRedirect('https://app.example/cb?tenant=a', { code: 'c', state: 'a b&c', iss: ISS }));

    expect(url.searchParams.get('tenant')).toBe('a');
    expect(url.searchParams.get('state')).toBe('a b&c');
  });
});
