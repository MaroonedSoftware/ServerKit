import { beforeEach, describe, expect, it } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { DynamicClientRegistrationService } from '../../src/oauth/dynamic.client.registration.service.js';
import { OAuthClientOptions } from '../../src/oauth/oauth.client.options.js';
import { FakeClientRepository, makeCapturingRecorder } from './oauth.fakes.js';

const CLAUDE = {
  client_name: 'Claude',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
};

let repository: FakeClientRepository;
let captured: ReturnType<typeof makeCapturingRecorder>;
let service: DynamicClientRegistrationService;

beforeEach(() => {
  repository = new FakeClientRepository();
  captured = makeCapturingRecorder();
  service = new DynamicClientRegistrationService(repository, new OAuthClientOptions(), captured.recorder);
});

describe('DynamicClientRegistrationService', () => {
  it('registers a public client that expires after the configured lifetime', async () => {
    const before = DateTime.utc();

    const { client, response } = await service.register(CLAUDE);

    expect(client).toMatchObject({ kind: 'dynamic', clientName: 'Claude', tokenEndpointAuthMethod: 'none', redirectUris: CLAUDE.redirect_uris });
    expect(client.clientId).toMatch(/^dyn_[A-Za-z0-9_-]{43}$/);
    expect(client.expiresAt!.diff(before).as('days')).toBeCloseTo(90, 1);
    expect(repository.clients.get(client.clientId)).toBe(client);
    expect(response).toEqual({
      client_id: client.clientId,
      client_id_issued_at: expect.any(Number),
      client_name: 'Claude',
      redirect_uris: CLAUDE.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  it('records the registration', async () => {
    const { client } = await service.register(CLAUDE);

    expect(captured.events).toMatchObject([
      {
        type: 'oauth.client.registered',
        category: 'credential',
        outcome: 'success',
        data: { clientId: client.clientId, clientName: 'Claude', redirectUris: CLAUDE.redirect_uris },
      },
    ]);
  });

  it('defaults the optional fields to a public authorization code client', async () => {
    const { client, response } = await service.register({ redirect_uris: ['http://localhost/callback'] });

    expect(client.tokenEndpointAuthMethod).toBe('none');
    expect(response.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(response.response_types).toEqual(['code']);
    expect('client_name' in response).toBe(false);
  });

  it('honours the configured prefix and lifetime', async () => {
    const custom = new DynamicClientRegistrationService(repository, new OAuthClientOptions(Duration.fromObject({ days: 7 }), 'mcp'));
    const before = DateTime.utc();

    const { client } = await custom.register(CLAUDE);

    expect(client.clientId.startsWith('mcp_')).toBe(true);
    expect(client.expiresAt!.diff(before).as('days')).toBeCloseTo(7, 1);
  });

  it('keeps https client and logo URIs', async () => {
    const { client } = await service.register({ ...CLAUDE, client_uri: 'https://claude.ai', logo_uri: 'https://claude.ai/logo.png' });
    expect(client).toMatchObject({ clientUri: 'https://claude.ai', logoUri: 'https://claude.ai/logo.png' });
  });

  it('issues a distinct client per registration', async () => {
    const a = await service.register(CLAUDE);
    const b = await service.register(CLAUDE);
    expect(a.client.clientId).not.toBe(b.client.clientId);
  });

  it.each([
    ['a non-object body', 'nonsense', 'invalid_client_metadata'],
    ['an array body', [CLAUDE], 'invalid_client_metadata'],
    ['no redirect_uris', { client_name: 'x' }, 'invalid_redirect_uri'],
    ['an empty redirect_uris', { redirect_uris: [] }, 'invalid_redirect_uri'],
    ['a non-string redirect URI', { redirect_uris: [42] }, 'invalid_redirect_uri'],
    ['an http non-loopback redirect URI', { redirect_uris: ['http://app.example/cb'] }, 'invalid_redirect_uri'],
    ['a custom-scheme redirect URI', { redirect_uris: ['myapp://cb'] }, 'invalid_redirect_uri'],
    ['a redirect URI with a fragment', { redirect_uris: ['https://app.example/cb#x'] }, 'invalid_redirect_uri'],
    ['too many redirect URIs', { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://app.example/cb${i}`) }, 'invalid_redirect_uri'],
    ['a confidential client', { ...CLAUDE, token_endpoint_auth_method: 'client_secret_basic' }, 'invalid_client_metadata'],
    ['an unsupported grant type', { ...CLAUDE, grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
    ['refresh without authorization_code', { ...CLAUDE, grant_types: ['refresh_token'] }, 'invalid_client_metadata'],
    ['an implicit response type', { ...CLAUDE, response_types: ['token'] }, 'invalid_client_metadata'],
    ['an overlong client_name', { ...CLAUDE, client_name: 'x'.repeat(201) }, 'invalid_client_metadata'],
    ['a non-string client_name', { ...CLAUDE, client_name: 7 }, 'invalid_client_metadata'],
    ['an http logo_uri', { ...CLAUDE, logo_uri: 'http://claude.ai/logo.png' }, 'invalid_client_metadata'],
    ['a malformed client_uri', { ...CLAUDE, client_uri: 'not a url' }, 'invalid_client_metadata'],
  ])('refuses %s', async (_label, body, code) => {
    await expect(service.register(body)).rejects.toMatchObject({ statusCode: 400, code });
    expect(repository.clients.size).toBe(0);
    expect(captured.events).toEqual([]);
  });
});
