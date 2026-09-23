import { describe, expect, it } from 'vitest';
import { parseAuthorizationRequest, type AuthorizationRequestQuery } from '../../src/oauth/authorization.request.js';
import type { OAuthClient } from '../../src/oauth/oauth.types.js';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const RESOURCE = 'https://station.example.com/api/mcp';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const CLIENT: OAuthClient = {
  clientId: 'dyn_claude',
  kind: 'dynamic',
  redirectUris: [REDIRECT, 'http://localhost/callback'],
  tokenEndpointAuthMethod: 'none',
};

const POLICY = { resources: [RESOURCE], scopesSupported: ['mcp'] };

const QUERY: AuthorizationRequestQuery = {
  client_id: 'dyn_claude',
  redirect_uri: REDIRECT,
  response_type: 'code',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  state: 'client-state',
  resource: RESOURCE,
  scope: 'mcp',
};

const parse = (overrides: AuthorizationRequestQuery = {}, policy = POLICY) => parseAuthorizationRequest({ ...QUERY, ...overrides }, CLIENT, policy);

describe('parseAuthorizationRequest', () => {
  it('accepts a complete request', () => {
    expect(parse()).toEqual({
      kind: 'valid',
      request: {
        clientId: 'dyn_claude',
        redirectUri: REDIRECT,
        responseType: 'code',
        codeChallenge: CHALLENGE,
        codeChallengeMethod: 'S256',
        state: 'client-state',
        scope: ['mcp'],
        resource: RESOURCE,
      },
    });
  });

  it('accepts a loopback redirect on the port the client picked, and keeps it exactly', () => {
    const result = parse({ redirect_uri: 'http://localhost:53682/callback' });
    expect(result).toMatchObject({ kind: 'valid', request: { redirectUri: 'http://localhost:53682/callback' } });
  });

  it('works without state', () => {
    const result = parse({ state: undefined });
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') expect('state' in result.request).toBe(false);
  });

  describe('scope', () => {
    it.each([
      ['absent', undefined, ['mcp']],
      ['blank', '', ['mcp']],
      ['only unsupported', 'openid profile', ['mcp']],
      ['mixed', 'openid mcp mcp', ['mcp']],
    ])('when %s, grants %j', (_label, scope, expected) => {
      expect(parse({ scope })).toMatchObject({ kind: 'valid', request: { scope: expected } });
    });

    it('keeps several supported scopes in request order', () => {
      expect(parse({ scope: 'write mcp' }, { ...POLICY, scopesSupported: ['mcp', 'write'] })).toMatchObject({
        request: { scope: ['write', 'mcp'] },
      });
    });
  });

  describe('resource', () => {
    it('defaults to the only resource when the request names none', () => {
      expect(parse({ resource: undefined })).toMatchObject({ kind: 'valid', request: { resource: RESOURCE } });
    });

    it('is required when the server has several', () => {
      expect(parse({ resource: undefined }, { ...POLICY, resources: [RESOURCE, 'https://other.example/api'] })).toMatchObject({
        kind: 'redirect',
        error: 'invalid_target',
      });
    });
  });

  describe('refuses without redirecting when the client or redirect_uri is not trustworthy', () => {
    it.each([
      ['a missing client_id', { client_id: undefined }],
      ['another client_id', { client_id: 'dyn_other' }],
      ['a repeated client_id', { client_id: ['dyn_claude', 'dyn_claude'] }],
      ['a missing redirect_uri', { redirect_uri: undefined }],
      ['an unregistered redirect_uri', { redirect_uri: 'https://evil.example/cb' }],
      ['a repeated redirect_uri', { redirect_uri: [REDIRECT, 'https://evil.example/cb'] }],
      ['a loopback redirect with another path', { redirect_uri: 'http://localhost:1/steal' }],
    ])('%s', (_label, overrides) => {
      const result = parse(overrides as AuthorizationRequestQuery);
      expect(result).toMatchObject({ kind: 'refuse', error: 'invalid_request' });
      expect('redirectUri' in result).toBe(false);
    });
  });

  describe('bounces the error back to the client otherwise', () => {
    it.each([
      ['an implicit response_type', { response_type: 'token' }, 'unsupported_response_type'],
      ['no response_type', { response_type: undefined }, 'unsupported_response_type'],
      ['no code_challenge', { code_challenge: undefined }, 'invalid_request'],
      ['a malformed code_challenge', { code_challenge: 'short' }, 'invalid_request'],
      ['the plain method', { code_challenge_method: 'plain' }, 'invalid_request'],
      ['no code_challenge_method', { code_challenge_method: undefined }, 'invalid_request'],
      ['an unknown resource', { resource: 'https://elsewhere.example/api' }, 'invalid_target'],
      ['a repeated resource', { resource: [RESOURCE, RESOURCE] }, 'invalid_request'],
      ['a repeated scope', { scope: ['mcp', 'mcp'] }, 'invalid_request'],
    ])('%s', (_label, overrides, error) => {
      expect(parse(overrides as AuthorizationRequestQuery)).toMatchObject({ kind: 'redirect', redirectUri: REDIRECT, error, state: 'client-state' });
    });

    it('without state when the request had none', () => {
      const result = parse({ response_type: 'token', state: undefined });
      expect(result.kind).toBe('redirect');
      expect('state' in result).toBe(false);
    });
  });
});
