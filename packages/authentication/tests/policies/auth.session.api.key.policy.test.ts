import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { PolicyEnvelope } from '@maroonedsoftware/policies';
import type { AuthenticationSession, AuthenticationSessionFactor } from '../../src/types.js';
import {
  API_KEY_SESSION_POLICY,
  API_KEY_WILDCARD_SCOPE,
  ApiKeySessionPolicy,
  getApiKeyClaim,
} from '../../src/policies/auth.session.api.key.policy.js';
import { MFA_SATISFIED_OR_API_KEY_POLICY, MfaSatisfiedOrApiKeyPolicy } from '../../src/policies/auth.session.mfa.satisfied.or.api.key.policy.js';
import type { ApiKeySessionClaim } from '../../src/apikey/types.js';

const envelope = {} as PolicyEnvelope;
const now = DateTime.utc();

const factor = (method: AuthenticationSessionFactor['method'], kind: AuthenticationSessionFactor['kind']): AuthenticationSessionFactor => ({
  issuedAt: now,
  authenticatedAt: now,
  method,
  methodId: `${method}-1`,
  kind,
});

const makeSession = (factors: AuthenticationSessionFactor[], claims: Record<string, unknown> = {}): AuthenticationSession => ({
  sessionToken: 'st',
  subject: 'user-1',
  issuedAt: now,
  lastAccessedAt: now,
  expiresAt: now.plus({ minutes: 5 }),
  factors,
  claims,
});

const claim = (scopes: string[]): ApiKeySessionClaim => ({
  id: 'key-1',
  name: 'CI',
  owner: { kind: 'user', actorId: 'user-1' },
  scopes,
  metadata: {},
});

const keySession = (scopes: string[] = []) => makeSession([factor('apikey', 'possession')], { apiKey: claim(scopes) });

describe('getApiKeyClaim', () => {
  it('reads the claim off a key session and nothing off a user session', () => {
    expect(getApiKeyClaim(keySession(['deploy']))?.id).toBe('key-1');
    expect(getApiKeyClaim(makeSession([factor('password', 'knowledge')]))).toBeUndefined();
  });

  it('ignores a non-object claim rather than trusting the shape', () => {
    expect(getApiKeyClaim(makeSession([], { apiKey: 'yes' }))).toBeUndefined();
    expect(getApiKeyClaim(makeSession([], { apiKey: null }))).toBeUndefined();
  });
});

describe('ApiKeySessionPolicy', () => {
  const policy = new ApiKeySessionPolicy();

  it('is registered under the exported name', () => {
    expect(API_KEY_SESSION_POLICY).toBe('auth.session.api.key');
  });

  it('allows any key session when no scope is required', async () => {
    await expect(policy.evaluate({ session: keySession() }, envelope)).resolves.toMatchObject({ allowed: true });
  });

  it('denies a session that no key established', async () => {
    const result = await policy.evaluate({ session: makeSession([factor('password', 'knowledge'), factor('fido', 'possession')]) }, envelope);

    expect(result).toMatchObject({ allowed: false, reason: 'api_key_required' });
  });

  it('allows a key holding the required scope', async () => {
    await expect(policy.evaluate({ session: keySession(['deploy', 'read']), scope: 'deploy' }, envelope)).resolves.toMatchObject({ allowed: true });
  });

  it('allows the wildcard scope', async () => {
    await expect(policy.evaluate({ session: keySession([API_KEY_WILDCARD_SCOPE]), scope: 'deploy' }, envelope)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('denies a key missing the scope, and names it in the challenge', async () => {
    const result = await policy.evaluate({ session: keySession(['read']), scope: 'deploy' }, envelope);

    expect(result).toMatchObject({ allowed: false, reason: 'insufficient_scope' });
    // RFC 6750: the client has to be able to tell "wrong key" from "key lacks this".
    expect(result).toMatchObject({ headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="deploy"' } });
  });

  it('denies a scope-less key when a scope is required', async () => {
    await expect(policy.evaluate({ session: keySession([]), scope: 'deploy' }, envelope)).resolves.toMatchObject({
      allowed: false,
      reason: 'insufficient_scope',
    });
  });
});

describe('MfaSatisfiedOrApiKeyPolicy', () => {
  const policy = new MfaSatisfiedOrApiKeyPolicy();

  it('is registered under the exported name', () => {
    expect(MFA_SATISFIED_OR_API_KEY_POLICY).toBe('auth.session.mfa.satisfied.or.api.key');
  });

  it('allows a key session that the plain MFA gate would reject', async () => {
    await expect(policy.evaluate({ session: keySession() }, envelope)).resolves.toMatchObject({ allowed: true });
  });

  it('still allows an MFA-satisfied user session', async () => {
    const session = makeSession([factor('password', 'knowledge'), factor('authenticator', 'possession')]);

    await expect(policy.evaluate({ session }, envelope)).resolves.toMatchObject({ allowed: true });
  });

  it('still denies a single-factor user session', async () => {
    const result = await policy.evaluate({ session: makeSession([factor('password', 'knowledge')]) }, envelope);

    expect(result).toMatchObject({ allowed: false, reason: 'mfa_required' });
  });
});
