import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { AuthorizationCodeService, AuthorizationCodeServiceOptions, type AuthorizationConsent } from '../../src/oauth/authorization.code.service.js';
import type { AuthorizationRequest } from '../../src/oauth/oauth.types.js';
import { makeCache } from './oauth.fakes.js';

// RFC 7636 Appendix B.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const REQUEST: AuthorizationRequest = {
  clientId: 'dyn_claude',
  redirectUri: 'http://localhost:53682/callback',
  responseType: 'code',
  codeChallenge: CHALLENGE,
  codeChallengeMethod: 'S256',
  state: 's',
  scope: ['mcp'],
  resource: 'https://station.example.com/api/mcp',
};

const CONSENT: AuthorizationConsent = {
  subject: 'user-1',
  claims: { role: 'admin' },
  factors: [
    {
      method: 'password',
      methodId: 'pw-1',
      kind: 'knowledge',
      issuedAt: DateTime.fromSeconds(1_700_000_000, { zone: 'utc' }),
      authenticatedAt: DateTime.fromSeconds(1_700_000_500, { zone: 'utc' }),
    },
  ],
};

const VERIFICATION = {
  clientId: 'dyn_claude',
  redirectUri: 'http://localhost:53682/callback',
  codeVerifier: VERIFIER,
  resource: 'https://station.example.com/api/mcp',
};

let cache: ReturnType<typeof makeCache>;
let codes: AuthorizationCodeService;

beforeEach(() => {
  cache = makeCache();
  codes = new AuthorizationCodeService(cache, new AuthorizationCodeServiceOptions());
});

describe('AuthorizationCodeService', () => {
  it('issues a code that redeems to the request and the consent behind it', async () => {
    const code = await codes.issue(REQUEST, CONSENT);

    const issued = await codes.redeem(code, VERIFICATION);

    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.request).toEqual(REQUEST);
    expect(issued.consent.subject).toBe('user-1');
    expect(issued.consent.claims).toEqual({ role: 'admin' });
    expect(issued.consent.factors[0]).toMatchObject({ method: 'password', methodId: 'pw-1', kind: 'knowledge' });
    expect(issued.consent.factors[0]!.authenticatedAt.toUnixInteger()).toBe(1_700_000_500);
    expect(issued.issuedAt).toBeInstanceOf(DateTime);
  });

  it('stores the code for the configured lifetime', async () => {
    await codes.issue(REQUEST, CONSENT);
    expect((vi.mocked(cache.set).mock.calls[0]?.[2] as Duration).as('seconds')).toBe(60);
  });

  it('redeems without a resource on the token request', async () => {
    const code = await codes.issue(REQUEST, CONSENT);
    const { resource: _resource, ...withoutResource } = VERIFICATION;

    await expect(codes.redeem(code, withoutResource)).resolves.toBeDefined();
  });

  it('refuses a replay, and deletes the code on first use', async () => {
    const code = await codes.issue(REQUEST, CONSENT);
    await codes.redeem(code, VERIFICATION);

    expect(cache.store.has(`oauth_code_${code}`)).toBe(false);
    const replay = await codes.redeem(code, VERIFICATION).catch(error => error);
    expect(replay).toMatchObject({ code: 'invalid_grant', statusCode: 400, internalDetails: { code: 'replayed' } });
  });

  it('lets only one of two concurrent redemptions succeed', async () => {
    const code = await codes.issue(REQUEST, CONSENT);

    const results = await Promise.allSettled([codes.redeem(code, VERIFICATION), codes.redeem(code, VERIFICATION)]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('marks the code consumed for at least a minute', async () => {
    const quick = new AuthorizationCodeService(cache, new AuthorizationCodeServiceOptions(Duration.fromObject({ seconds: 10 })));
    const code = await quick.issue(REQUEST, CONSENT);

    await quick.redeem(code, VERIFICATION);

    const addOptions = vi.mocked(cache.add).mock.calls[0]?.[2] as { ttl: Duration };
    expect(addOptions.ttl.as('seconds')).toBe(60);
  });

  it.each([
    ['another client', { clientId: 'dyn_other' }],
    ['another redirect_uri', { redirectUri: 'http://localhost:1/callback' }],
    ['a wrong verifier', { codeVerifier: 'x'.repeat(43) }],
    ['a verifier outside the RFC alphabet', { codeVerifier: 'short' }],
    ['another resource', { resource: 'https://elsewhere.example/api' }],
  ])('refuses %s, and the code is spent', async (_label, change) => {
    const code = await codes.issue(REQUEST, CONSENT);

    await expect(codes.redeem(code, { ...VERIFICATION, ...change })).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(codes.redeem(code, VERIFICATION)).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('refuses a code it never issued, or one that is malformed', async () => {
    await expect(codes.redeem('A'.repeat(43), VERIFICATION)).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(codes.redeem('not a code', VERIFICATION)).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(cache.add).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired code even if the cache still holds it', async () => {
    const code = await codes.issue(REQUEST, CONSENT);
    const key = `oauth_code_${code}`;
    const stored = JSON.parse(cache.store.get(key)!);
    cache.store.set(key, JSON.stringify({ ...stored, expiresAt: DateTime.utc().minus({ seconds: 1 }).toUnixInteger() }));

    await expect(codes.redeem(code, VERIFICATION)).rejects.toMatchObject({
      code: 'invalid_grant',
      description: 'the authorization code has expired',
    });
  });
});
