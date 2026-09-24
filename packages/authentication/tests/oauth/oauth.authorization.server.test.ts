import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientIdMetadataDocumentResolver } from '../../src/oauth/client.id.metadata.document.resolver.js';
import { getOAuthSessionClaim } from '../../src/oauth/oauth.session.claim.js';
import {
  CONSENT_FACTOR,
  FakeGrantRepository,
  ISSUER,
  PUBLIC_CLIENT,
  RESOURCE,
  VERIFIER,
  authorizeQuery,
  makeAuthorizationServerHarness,
} from './oauth.fakes.js';

const CONSENT = { subject: 'user-1', claims: { role: 'admin' }, factors: [CONSENT_FACTOR] };

let harness: ReturnType<typeof makeAuthorizationServerHarness>;

const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

beforeEach(() => {
  harness = makeAuthorizationServerHarness({ grants: new FakeGrantRepository() });
  harness.repository.clients.set(PUBLIC_CLIENT.clientId, PUBLIC_CLIENT);
});

describe('OAuthAuthorizationServer.metadata', () => {
  it('advertises the endpoints, with registration when it is on', () => {
    expect(harness.server.metadata()).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/api/auth/oauth/token`,
      registration_endpoint: `${ISSUER}/api/auth/oauth/register`,
      scopes_supported: ['mcp'],
      client_id_metadata_document_supported: false,
    });
  });

  it('leaves out registration when it is off', () => {
    const off = makeAuthorizationServerHarness({ registration: false });
    expect('registration_endpoint' in off.server.metadata()).toBe(false);
    expect(off.server.registrationEnabled).toBe(false);
  });

  it('advertises client id metadata documents only when a resolver is bound', () => {
    const withDocuments = makeAuthorizationServerHarness({ metadataDocuments: { resolve: vi.fn() } as unknown as ClientIdMetadataDocumentResolver });
    expect(withDocuments.server.metadata().client_id_metadata_document_supported).toBe(true);
  });
});

describe('OAuthAuthorizationServer.resourceMetadata', () => {
  it('describes a served resource and nothing else', () => {
    expect(harness.server.resourceMetadata(RESOURCE)).toEqual({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
    });
    expect(harness.server.resourceMetadata('https://elsewhere.example/api')).toBeUndefined();
  });
});

describe('OAuthAuthorizationServer.describeAuthorizationRequest', () => {
  it('stashes a valid request and describes it for the consent page', async () => {
    const result = await harness.server.describeAuthorizationRequest(authorizeQuery(), 'user-1');

    expect(result).toEqual({
      kind: 'context',
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      clientId: 'dyn_claude',
      clientKind: 'dynamic',
      clientName: 'Claude',
      redirectHost: 'claude.ai',
      loopbackOnly: false,
      scope: ['mcp'],
      resource: RESOURCE,
    });
  });

  it('flags a client whose every redirect is loopback', async () => {
    harness.repository.clients.set('dyn_cli', { ...PUBLIC_CLIENT, clientId: 'dyn_cli', redirectUris: ['http://localhost/callback'] });

    const result = await harness.server.describeAuthorizationRequest(
      authorizeQuery({ client_id: 'dyn_cli', redirect_uri: 'http://localhost:53682/callback' }),
      'user-1',
    );

    expect(result).toMatchObject({ kind: 'context', redirectHost: 'localhost:53682', loopbackOnly: true });
  });

  it('refuses an unknown client without redirecting', async () => {
    await expect(harness.server.describeAuthorizationRequest(authorizeQuery({ client_id: 'nobody' }), 'user-1')).resolves.toEqual({
      kind: 'refuse',
      error: 'invalid_client',
      description: 'unknown client',
    });
  });

  it('refuses a missing client_id without redirecting', async () => {
    await expect(harness.server.describeAuthorizationRequest(authorizeQuery({ client_id: undefined }), 'user-1')).resolves.toMatchObject({
      kind: 'refuse',
      error: 'invalid_request',
    });
  });

  it('refuses an unregistered redirect_uri without redirecting', async () => {
    await expect(
      harness.server.describeAuthorizationRequest(authorizeQuery({ redirect_uri: 'https://evil.example/cb' }), 'user-1'),
    ).resolves.toMatchObject({ kind: 'refuse' });
  });

  it('bounces other errors to the client with state and iss', async () => {
    const result = await harness.server.describeAuthorizationRequest(authorizeQuery({ code_challenge_method: 'plain' }), 'user-1');

    expect(result.kind).toBe('redirect');
    if (result.kind !== 'redirect') throw new Error('unreachable');
    expect(result.redirectUrl.startsWith('https://claude.ai/api/mcp/auth_callback?')).toBe(true);
    expect(params(result.redirectUrl)).toEqual({
      error: 'invalid_request',
      error_description: 'code_challenge_method must be S256',
      state: 'client-state',
      iss: ISSUER,
    });
  });
});

describe('OAuthAuthorizationServer.approve and deny', () => {
  const describeFor = async (subject = 'user-1') => {
    const result = await harness.server.describeAuthorizationRequest(authorizeQuery(), subject);
    if (result.kind !== 'context') throw new Error('expected a context');
    return result.requestId;
  };

  it('approves with a code, the state, and the issuer, and records it', async () => {
    const requestId = await describeFor();

    const { redirectUrl } = await harness.server.approve(requestId, CONSENT);

    expect(params(redirectUrl)).toEqual({ code: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), state: 'client-state', iss: ISSUER });
    expect(harness.events.find(event => event.type === 'oauth.authorization.approved')).toMatchObject({
      category: 'privilege',
      actorId: 'user-1',
      data: { clientId: 'dyn_claude', resource: RESOURCE, scope: ['mcp'] },
    });
  });

  it('decides a request once', async () => {
    const requestId = await describeFor();
    await harness.server.approve(requestId, CONSENT);

    await expect(harness.server.approve(requestId, CONSENT)).rejects.toMatchObject({ statusCode: 404 });
    await expect(harness.server.deny(requestId, 'user-1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it("will not let another user decide someone's request", async () => {
    const requestId = await describeFor('user-1');

    await expect(harness.server.approve(requestId, { ...CONSENT, subject: 'user-2' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(harness.server.approve(requestId, CONSENT)).resolves.toBeDefined();
  });

  it('denies with access_denied, the state, and the issuer, and records it', async () => {
    const requestId = await describeFor();

    const { redirectUrl } = await harness.server.deny(requestId, 'user-1');

    expect(params(redirectUrl)).toEqual({
      error: 'access_denied',
      error_description: 'the user denied the request',
      state: 'client-state',
      iss: ISSUER,
    });
    expect(harness.events.find(event => event.type === 'oauth.authorization.denied')).toMatchObject({
      outcome: 'success',
      actorId: 'user-1',
      data: { clientId: 'dyn_claude', resource: RESOURCE },
    });
  });
});

describe('a consent that grants a scope of its own', () => {
  const SCOPES = ['mcp', 'read', 'write'];
  let grants: FakeGrantRepository;

  beforeEach(() => {
    grants = new FakeGrantRepository();
    harness = makeAuthorizationServerHarness({ grants, scopesSupported: SCOPES });
    harness.repository.clients.set(PUBLIC_CLIENT.clientId, PUBLIC_CLIENT);
  });

  const requestFor = async (scope = 'mcp') => {
    const result = await harness.server.describeAuthorizationRequest(authorizeQuery({ scope }), 'user-1');
    if (result.kind !== 'context') throw new Error('expected a context');
    return result.requestId;
  };

  const exchange = async (redirectUrl: string) =>
    harness.server.token({
      grant_type: 'authorization_code',
      code: params(redirectUrl).code!,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_verifier: VERIFIER,
      client_id: PUBLIC_CLIENT.clientId,
    });

  it('replaces the requested scope in the grant, the session and the token response', async () => {
    // The client asked for `mcp` alone; the user chose `read` on the consent page.
    const { redirectUrl } = await harness.server.approve(await requestFor('mcp'), { ...CONSENT, scope: ['mcp', 'read'] });

    const tokens = await exchange(redirectUrl);

    expect(tokens.scope).toBe('mcp read');
    expect([...grants.grants.values()].map(grant => grant.scope)).toEqual([['mcp', 'read']]);
    const { session } = await harness.sessions.lookupSessionFromJwt(tokens.access_token, false, RESOURCE);
    expect(getOAuthSessionClaim(session)?.scope).toEqual(['mcp', 'read']);
  });

  it('records what was granted beside what was asked for', async () => {
    await harness.server.approve(await requestFor('mcp read write'), { ...CONSENT, scope: ['mcp', 'read'] });

    expect(harness.events.find(event => event.type === 'oauth.authorization.approved')?.data).toEqual({
      clientId: 'dyn_claude',
      resource: RESOURCE,
      scope: ['mcp', 'read'],
      requestedScope: ['mcp', 'read', 'write'],
    });
  });

  it('grants each value once', async () => {
    const { redirectUrl } = await harness.server.approve(await requestFor(), { ...CONSENT, scope: ['read', 'read', 'mcp'] });

    expect((await exchange(redirectUrl)).scope).toBe('read mcp');
  });

  it('refuses a scope the server does not support, and leaves the request to be answered again', async () => {
    const requestId = await requestFor();

    await expect(harness.server.approve(requestId, { ...CONSENT, scope: ['mcp', 'admin'] })).rejects.toMatchObject({
      statusCode: 400,
      details: { scope: 'not supported: admin' },
    });
    await expect(harness.server.approve(requestId, { ...CONSENT, scope: ['mcp'] })).resolves.toBeDefined();
  });

  it('grants the request as asked when the consent names no scope', async () => {
    const { redirectUrl } = await harness.server.approve(await requestFor('mcp write'), CONSENT);

    expect((await exchange(redirectUrl)).scope).toBe('mcp write');
    expect(harness.events.find(event => event.type === 'oauth.authorization.approved')?.data).not.toHaveProperty('requestedScope');
  });
});

describe('OAuthAuthorizationServer.register', () => {
  it('registers a client when registration is on', async () => {
    const { client, response } = await harness.server.register({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude' });

    expect(client.kind).toBe('dynamic');
    expect(response.client_id).toBe(client.clientId);
  });

  it('answers 404 when registration is off', async () => {
    const off = makeAuthorizationServerHarness({ registration: false });
    await expect(off.server.register({ redirect_uris: ['https://claude.ai/cb'] })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('the whole flow, as a connector runs it', () => {
  it('registers, consents, exchanges, refreshes, and is refused everywhere it should be', async () => {
    const { server, sessions } = harness;

    // 1. Discovery, then Dynamic Client Registration.
    expect(server.metadata().code_challenge_methods_supported).toEqual(['S256']);
    const { response: registered } = await server.register({
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    });

    // 2. The user lands on the consent page and allows.
    const context = await server.describeAuthorizationRequest(authorizeQuery({ client_id: registered.client_id }), 'user-1');
    if (context.kind !== 'context') throw new Error(`expected consent, got ${context.kind}`);
    const { redirectUrl } = await server.approve(context.requestId, CONSENT);
    const { code, state, iss } = params(redirectUrl);
    expect({ state, iss }).toEqual({ state: 'client-state', iss: ISSUER });

    // 3. The client exchanges the code with its PKCE verifier.
    const issued = await server.token({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_verifier: VERIFIER,
      client_id: registered.client_id,
      resource: RESOURCE,
    });

    // 4. The token works on the MCP resource, and nowhere else.
    await expect(sessions.lookupSessionFromJwt(issued.access_token, false, RESOURCE)).resolves.toBeDefined();
    await expect(sessions.lookupSessionFromJwt(issued.access_token)).rejects.toMatchObject({ statusCode: 401 });

    // 5. The code is single use.
    await expect(
      server.token({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: VERIFIER,
        client_id: registered.client_id,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });

    // 6. Refresh rotates; replaying the old refresh token is invalid_grant and kills the family.
    const refreshed = await server.token({ grant_type: 'refresh_token', refresh_token: issued.refresh_token!, client_id: registered.client_id });
    await expect(sessions.lookupSessionFromJwt(refreshed.access_token, false, RESOURCE)).resolves.toBeDefined();
    await expect(
      server.token({ grant_type: 'refresh_token', refresh_token: issued.refresh_token!, client_id: registered.client_id }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(sessions.lookupSessionFromJwt(refreshed.access_token, false, RESOURCE)).rejects.toMatchObject({ statusCode: 401 });

    // 7. The audit trail tells the story.
    const oauthEvents = harness.events.map(event => event.type).filter(type => type.startsWith('oauth.'));
    expect(oauthEvents).toEqual([
      'oauth.client.registered',
      'oauth.authorization.approved',
      'oauth.token.issued',
      'oauth.token.rejected',
      'oauth.token.refreshed',
      'oauth.token.rejected',
    ]);
  });
});
