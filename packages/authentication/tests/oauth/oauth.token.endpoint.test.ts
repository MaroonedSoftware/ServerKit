import { beforeEach, describe, expect, it } from 'vitest';
import jsonwebtoken from 'jsonwebtoken';
import { getOAuthSessionClaim } from '../../src/oauth/oauth.session.claim.js';
import { createOAuthClientSecret } from '../../src/oauth/oauth.client.secret.js';
import {
  CHALLENGE,
  CONSENT_FACTOR,
  CONSOLE_AUDIENCE,
  FakeGrantRepository,
  PUBLIC_CLIENT,
  RESOURCE,
  VERIFIER,
  makeAuthorizationServerHarness,
} from './oauth.fakes.js';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let harness: ReturnType<typeof makeAuthorizationServerHarness>;
let grants: FakeGrantRepository;

/** Issue a code the way an approval does, for `PUBLIC_CLIENT`. */
const issueCode = (claims: Record<string, unknown> = { role: 'admin' }) =>
  harness.codes.issue(
    {
      clientId: PUBLIC_CLIENT.clientId,
      redirectUri: REDIRECT,
      responseType: 'code',
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      scope: ['mcp'],
      resource: RESOURCE,
    },
    { subject: 'user-1', claims, factors: [CONSENT_FACTOR] },
  );

const exchangeCode = async (overrides: Record<string, unknown> = {}) =>
  harness.tokens.exchange({
    grant_type: 'authorization_code',
    code: await issueCode(),
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
    client_id: PUBLIC_CLIENT.clientId,
    resource: RESOURCE,
    ...overrides,
  });

const refresh = (refreshToken: string, overrides: Record<string, unknown> = {}) =>
  harness.tokens.exchange({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: PUBLIC_CLIENT.clientId, ...overrides });

const rejections = () =>
  harness.events.filter(event => event.type === 'oauth.token.rejected').map(event => (event.data as { reason: string }).reason);

beforeEach(() => {
  grants = new FakeGrantRepository();
  harness = makeAuthorizationServerHarness({ grants });
  harness.repository.clients.set(PUBLIC_CLIENT.clientId, PUBLIC_CLIENT);
});

describe('OAuthTokenEndpoint: authorization_code', () => {
  it('answers an RFC 6749 token response', async () => {
    const response = await exchangeCode();

    expect(response).toEqual({
      access_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: expect.any(Number),
      refresh_token: expect.any(String),
      scope: 'mcp',
    });
    expect(response.expires_in).toBeGreaterThan(3500);
  });

  it('mints a session for the consenting user, bound to the resource, carrying claims.oauth', async () => {
    const { access_token } = await exchangeCode();

    const { session } = await harness.sessions.lookupSessionFromJwt(access_token, false, RESOURCE);

    expect(session.subject).toBe('user-1');
    expect(session.audience).toBe(RESOURCE);
    expect(session.factors).toMatchObject([{ method: 'password', methodId: 'pw-1', kind: 'knowledge' }]);
    expect(session.claims).toMatchObject({ role: 'admin' });
    expect(getOAuthSessionClaim(session)).toEqual({
      clientId: 'dyn_claude',
      clientName: 'Claude',
      resource: RESOURCE,
      scope: ['mcp'],
      grantId: 'grant-1',
    });
    expect((jsonwebtoken.decode(access_token) as { aud: string }).aud).toBe(RESOURCE);
  });

  it('issues a token every other route refuses', async () => {
    const { access_token } = await exchangeCode();

    await expect(harness.sessions.lookupSessionFromJwt(access_token)).rejects.toMatchObject({ statusCode: 401 });
    expect(harness.events.at(-1)).toMatchObject({ type: 'session.validation_failed', data: { reason: 'audience_mismatch' } });
  });

  it('records the grant, its use, the client use, and the issue', async () => {
    const before = harness.repository.touches.length;

    await exchangeCode();

    expect([...grants.grants.values()]).toMatchObject([
      { id: 'grant-1', clientId: 'dyn_claude', subject: 'user-1', resource: RESOURCE, scope: ['mcp'] },
    ]);
    expect(grants.uses.map(use => use.id)).toEqual(['grant-1']);
    expect(harness.repository.touches.length).toBe(before + 1);
    expect(harness.repository.touches.at(-1)?.extendTo).toBeDefined();
    expect(harness.events.find(event => event.type === 'oauth.token.issued')).toMatchObject({
      category: 'login',
      outcome: 'success',
      actorId: 'user-1',
      data: { clientId: 'dyn_claude', resource: RESOURCE, grantId: 'grant-1', sessionToken: expect.any(String) },
    });
  });

  it('works without a grant repository', async () => {
    harness = makeAuthorizationServerHarness();
    harness.repository.clients.set(PUBLIC_CLIENT.clientId, PUBLIC_CLIENT);

    const { access_token, refresh_token } = await exchangeCode();
    const { session } = await harness.sessions.lookupSessionFromJwt(access_token, false, RESOURCE);

    expect(getOAuthSessionClaim(session)?.grantId).toBeUndefined();
    await expect(refresh(refresh_token!)).resolves.toMatchObject({ token_type: 'Bearer' });
  });

  it.each([
    ['code', { code: undefined }],
    ['redirect_uri', { redirect_uri: undefined }],
    ['code_verifier', { code_verifier: undefined }],
  ])('requires %s', async (name, overrides) => {
    await expect(exchangeCode(overrides)).rejects.toMatchObject({ code: 'invalid_request', description: `${name} is required` });
  });

  it('refuses a wrong verifier as invalid_grant, and records it', async () => {
    await expect(exchangeCode({ code_verifier: 'x'.repeat(43) })).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(rejections()).toEqual(['invalid_grant']);
  });

  it('refuses an unknown client with a 401 invalid_client', async () => {
    await expect(exchangeCode({ client_id: 'nobody' })).rejects.toMatchObject({ code: 'invalid_client', statusCode: 401 });
  });

  it('authenticates a confidential client before redeeming', async () => {
    const { secret, secretHash } = createOAuthClientSecret();
    harness.repository.clients.set(PUBLIC_CLIENT.clientId, {
      ...PUBLIC_CLIENT,
      kind: 'preregistered',
      tokenEndpointAuthMethod: 'client_secret_post',
      secretHash,
    });

    await expect(exchangeCode({ client_secret: 'wrong' })).rejects.toMatchObject({ code: 'invalid_client' });
    await expect(exchangeCode({ client_secret: secret })).resolves.toMatchObject({ token_type: 'Bearer' });
  });
});

describe('OAuthTokenEndpoint: refresh_token', () => {
  it('rotates the refresh token and keeps the session bound to the resource', async () => {
    const first = await exchangeCode();

    const second = await refresh(first.refresh_token!);

    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.scope).toBe('mcp');
    expect((jsonwebtoken.decode(second.access_token) as { aud: string }).aud).toBe(RESOURCE);
    expect(harness.events.find(event => event.type === 'oauth.token.refreshed')).toMatchObject({
      actorId: 'user-1',
      data: { clientId: 'dyn_claude', resource: RESOURCE, grantId: 'grant-1' },
    });
  });

  it('accepts a matching resource parameter', async () => {
    const { refresh_token } = await exchangeCode();
    await expect(refresh(refresh_token!, { resource: RESOURCE })).resolves.toBeDefined();
  });

  it('refuses an unserved resource parameter as invalid_target', async () => {
    const { refresh_token } = await exchangeCode();
    await expect(refresh(refresh_token!, { resource: 'https://elsewhere.example/api' })).rejects.toMatchObject({ code: 'invalid_target' });
  });

  it('refuses a replayed refresh token with invalid_grant, never a bare 401', async () => {
    const { refresh_token } = await exchangeCode();
    await refresh(refresh_token!);

    await expect(refresh(refresh_token!)).rejects.toMatchObject({ code: 'invalid_grant', statusCode: 400 });
    expect(harness.events.some(event => event.type === 'session.refresh_reuse_detected')).toBe(true);
  });

  it('refuses garbage with invalid_grant', async () => {
    await expect(refresh('not-a-token')).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('refuses another client, which spends the token so the real client trips theft detection', async () => {
    harness.repository.clients.set('dyn_other', { ...PUBLIC_CLIENT, clientId: 'dyn_other' });
    const { refresh_token } = await exchangeCode();

    await expect(refresh(refresh_token!, { client_id: 'dyn_other' })).rejects.toMatchObject({
      code: 'invalid_grant',
      description: 'the refresh token was not issued to this client',
    });
    await expect(refresh(refresh_token!)).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(harness.events.some(event => event.type === 'session.refresh_reuse_detected')).toBe(true);
  });

  it('refuses a refresh under a revoked grant', async () => {
    const { refresh_token } = await exchangeCode();
    grants.revoke('grant-1');

    await expect(refresh(refresh_token!)).rejects.toMatchObject({ code: 'invalid_grant', description: 'the grant has been revoked' });
  });

  it("refuses the consumer's own refresh tokens without spending them", async () => {
    const console = await harness.sessions.createSession('user-1', {}, CONSENT_FACTOR);
    const { refreshToken } = await harness.sessions.issueTokenForSession(console.sessionToken);

    await expect(refresh(refreshToken!)).rejects.toMatchObject({ code: 'invalid_grant' });

    const rotated = await harness.sessions.refreshSession(refreshToken!);
    expect((jsonwebtoken.decode(rotated.accessToken) as { aud: string }).aud).toBe(CONSOLE_AUDIENCE);
  });

  it('requires refresh_token', async () => {
    await expect(harness.tokens.exchange({ grant_type: 'refresh_token', client_id: 'dyn_claude' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });
});

describe('OAuthTokenEndpoint: the request itself', () => {
  it('requires grant_type', async () => {
    await expect(harness.tokens.exchange({ client_id: 'dyn_claude' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it.each(['client_credentials', 'password', 'urn:ietf:params:oauth:grant-type:device_code'])('refuses the %s grant', async grantType => {
    await expect(harness.tokens.exchange({ grant_type: grantType })).rejects.toMatchObject({ code: 'unsupported_grant_type' });
    expect(harness.events.at(-1)).toMatchObject({
      type: 'oauth.token.rejected',
      category: 'login',
      outcome: 'failure',
      data: { reason: 'unsupported_grant_type', grantType },
    });
  });

  it('refuses a parameter that is not a single string', async () => {
    await expect(harness.tokens.exchange({ grant_type: ['authorization_code', 'refresh_token'] })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });
});
