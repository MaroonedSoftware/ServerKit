import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { PolicyEnvelope } from '@maroonedsoftware/policies';
import type { AuthenticationSession } from '../../src/types.js';
import { SESSION_SCOPE_POLICY, SessionScopePolicy, getSessionScopes } from '../../src/policies/auth.session.scope.policy.js';
import { AuthenticationPolicyMappings } from '../../src/policies/policy.mappings.js';
import type { ApiKeySessionClaim } from '../../src/apikey/types.js';
import type { OAuthSessionClaim } from '../../src/oauth/oauth.session.claim.js';

const envelope = {} as PolicyEnvelope;
const now = DateTime.utc();

const makeSession = (claims: Record<string, unknown> = {}): AuthenticationSession => ({
  sessionToken: 'st',
  subject: 'user-1',
  issuedAt: now,
  lastAccessedAt: now,
  expiresAt: now.plus({ minutes: 5 }),
  factors: [],
  claims,
});

const oauthSession = (scope: string[]) =>
  makeSession({ oauth: { clientId: 'client-1', resource: 'https://api.example.com/mcp', scope } satisfies OAuthSessionClaim });

const keySession = (scopes: string[]) =>
  makeSession({ apiKey: { id: 'key-1', name: 'CI', owner: { kind: 'user', actorId: 'user-1' }, scopes, metadata: {} } satisfies ApiKeySessionClaim });

describe('getSessionScopes', () => {
  it('reads an OAuth grant’s scopes, a key’s scopes, and nothing off the person’s own session', () => {
    expect(getSessionScopes(oauthSession(['read']))).toEqual(['read']);
    expect(getSessionScopes(keySession(['deploy']))).toEqual(['deploy']);
    expect(getSessionScopes(makeSession())).toBeUndefined();
  });

  it('ignores a malformed OAuth claim rather than trusting the shape', () => {
    expect(getSessionScopes(makeSession({ oauth: { clientId: 'client-1' } }))).toBeUndefined();
  });
});

describe('SessionScopePolicy', () => {
  const policy = new SessionScopePolicy();

  it('is registered under the exported name', () => {
    expect(SESSION_SCOPE_POLICY).toBe('auth.session.scope');
    expect(AuthenticationPolicyMappings[SESSION_SCOPE_POLICY]).toBe(SessionScopePolicy);
  });

  it('allows the person’s own session, which no scope narrows', async () => {
    await expect(policy.evaluate({ session: makeSession(), scope: 'write' }, envelope)).resolves.toMatchObject({ allowed: true });
  });

  it('allows an OAuth grant consented to the scope', async () => {
    await expect(policy.evaluate({ session: oauthSession(['read', 'write']), scope: 'write' }, envelope)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('denies an OAuth grant without the scope, and names it in the challenge', async () => {
    const result = await policy.evaluate({ session: oauthSession(['read']), scope: 'write' }, envelope);

    expect(result).toMatchObject({ allowed: false, reason: 'insufficient_scope' });
    expect(result).toMatchObject({ headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="write"' } });
  });

  it('gives an OAuth grant no wildcard', async () => {
    await expect(policy.evaluate({ session: oauthSession(['*']), scope: 'write' }, envelope)).resolves.toMatchObject({ allowed: false });
  });

  it('allows a key holding the scope or the wildcard', async () => {
    await expect(policy.evaluate({ session: keySession(['write']), scope: 'write' }, envelope)).resolves.toMatchObject({ allowed: true });
    await expect(policy.evaluate({ session: keySession(['*']), scope: 'write' }, envelope)).resolves.toMatchObject({ allowed: true });
  });

  it('denies a key without the scope', async () => {
    await expect(policy.evaluate({ session: keySession(['read']), scope: 'write' }, envelope)).resolves.toMatchObject({
      allowed: false,
      reason: 'insufficient_scope',
    });
  });
});
