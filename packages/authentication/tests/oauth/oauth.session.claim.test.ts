import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { getOAuthSessionClaim } from '../../src/oauth/oauth.session.claim.js';
import type { AuthenticationSession } from '../../src/types.js';

const session = (claims: Record<string, unknown>): AuthenticationSession => ({
  sessionToken: 's',
  subject: 'user-1',
  issuedAt: DateTime.utc(),
  expiresAt: DateTime.utc(),
  lastAccessedAt: DateTime.utc(),
  factors: [],
  claims,
});

describe('getOAuthSessionClaim', () => {
  it('reads the claim the token endpoint stamps', () => {
    const oauth = { clientId: 'dyn_claude', resource: 'https://r.example/mcp', scope: ['mcp'], grantId: 'g' };
    expect(getOAuthSessionClaim(session({ oauth }))).toEqual(oauth);
  });

  it.each([
    ['no claim', {}],
    ['a string', { oauth: 'yes' }],
    ['null', { oauth: null }],
    ['a claim without a client', { oauth: { resource: 'r', scope: [] } }],
    ['a claim without a scope list', { oauth: { clientId: 'c', resource: 'r', scope: 'mcp' } }],
  ])('answers undefined for %s', (_label, claims) => {
    expect(getOAuthSessionClaim(session(claims))).toBeUndefined();
  });
});
