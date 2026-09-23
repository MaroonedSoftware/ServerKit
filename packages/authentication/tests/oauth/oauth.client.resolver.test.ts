import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { ClientIdMetadataDocumentResolver } from '../../src/oauth/client.id.metadata.document.resolver.js';
import { OAuthClientOptions } from '../../src/oauth/oauth.client.options.js';
import { OAuthClientResolver, parseBasicClientCredentials } from '../../src/oauth/oauth.client.resolver.js';
import { createOAuthClientSecret, hashOAuthClientSecret } from '../../src/oauth/oauth.client.secret.js';
import type { OAuthClient } from '../../src/oauth/oauth.types.js';
import { FakeClientRepository } from './oauth.fakes.js';

const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;

const PUBLIC: OAuthClient = {
  clientId: 'dyn_public',
  kind: 'dynamic',
  redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
  tokenEndpointAuthMethod: 'none',
  expiresAt: DateTime.utc().plus({ days: 30 }),
};

const { secret: SECRET, secretHash: SECRET_HASH } = createOAuthClientSecret();

const POST_CLIENT: OAuthClient = {
  clientId: 'pre_post',
  kind: 'preregistered',
  redirectUris: ['https://app.example/cb'],
  tokenEndpointAuthMethod: 'client_secret_post',
  secretHash: SECRET_HASH,
};

const BASIC_CLIENT: OAuthClient = { ...POST_CLIENT, clientId: 'pre_basic', tokenEndpointAuthMethod: 'client_secret_basic' };

let repository: FakeClientRepository;
let resolver: OAuthClientResolver;

beforeEach(() => {
  repository = new FakeClientRepository();
  for (const client of [PUBLIC, POST_CLIENT, BASIC_CLIENT]) repository.clients.set(client.clientId, client);
  resolver = new OAuthClientResolver(repository, new OAuthClientOptions());
});

describe('OAuthClientResolver.resolve', () => {
  it('finds a stored client', async () => {
    await expect(resolver.resolve('dyn_public')).resolves.toBe(PUBLIC);
  });

  it('refuses an unknown, blank, or expired client', async () => {
    repository.clients.set('dyn_old', { ...PUBLIC, clientId: 'dyn_old', expiresAt: DateTime.utc().minus({ seconds: 1 }) });

    await expect(resolver.resolve('nobody')).rejects.toMatchObject({ code: 'invalid_client', statusCode: 400 });
    await expect(resolver.resolve('')).rejects.toMatchObject({ code: 'invalid_client' });
    await expect(resolver.resolve('dyn_old')).rejects.toMatchObject({ code: 'invalid_client', description: 'the client registration has expired' });
  });

  it('sends an https client id to the metadata-document resolver when one is bound', async () => {
    const document: OAuthClient = { ...PUBLIC, clientId: 'https://claude.ai/oauth/meta', kind: 'metadata_document' };
    const metadataDocuments = { resolve: vi.fn(async () => document) } as unknown as ClientIdMetadataDocumentResolver;
    const withDocuments = new OAuthClientResolver(repository, new OAuthClientOptions(), metadataDocuments);

    await expect(withDocuments.resolve('https://claude.ai/oauth/meta')).resolves.toBe(document);
    expect(withDocuments.supportsMetadataDocuments).toBe(true);
    expect(resolver.supportsMetadataDocuments).toBe(false);
  });

  it('treats an https client id as unknown when no metadata-document resolver is bound', async () => {
    await expect(resolver.resolve('https://claude.ai/oauth/meta')).rejects.toMatchObject({ code: 'invalid_client' });
  });
});

describe('OAuthClientResolver.authenticate', () => {
  it('accepts a public client that presents no secret', async () => {
    await expect(resolver.authenticate({ clientId: 'dyn_public' })).resolves.toBe(PUBLIC);
  });

  it('refuses a public client that presents a secret', async () => {
    await expect(resolver.authenticate({ clientId: 'dyn_public', clientSecret: 'x' })).rejects.toMatchObject({
      code: 'invalid_client',
      statusCode: 401,
    });
  });

  it('accepts client_secret_post with the right secret, in the body', async () => {
    await expect(resolver.authenticate({ clientId: 'pre_post', clientSecret: SECRET })).resolves.toBe(POST_CLIENT);
  });

  it('accepts client_secret_basic with the right secret, in the header', async () => {
    await expect(resolver.authenticate({ authorization: basic('pre_basic', SECRET) })).resolves.toBe(BASIC_CLIENT);
  });

  it.each([
    ['a wrong post secret', { clientId: 'pre_post', clientSecret: 'wrong' }],
    ['a missing post secret', { clientId: 'pre_post' }],
    ['a post client using Basic', { authorization: basic('pre_post', SECRET) }],
    ['a basic client using the body', { clientId: 'pre_basic', clientSecret: SECRET }],
    ['an unknown client', { clientId: 'nobody' }],
    ['no client id at all', {}],
  ])('refuses %s with a 401', async (_label, credentials) => {
    await expect(resolver.authenticate(credentials)).rejects.toMatchObject({ code: 'invalid_client', statusCode: 401 });
  });

  it('challenges with Basic when the header was used', async () => {
    const error = await resolver.authenticate({ authorization: basic('pre_basic', 'wrong') }).catch(e => e);

    expect(error).toMatchObject({ code: 'invalid_client', statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="oauth"' } });
  });

  it('refuses a body client_id that disagrees with the header', async () => {
    await expect(resolver.authenticate({ clientId: 'pre_post', authorization: basic('pre_basic', SECRET) })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('refuses credentials presented in both places', async () => {
    await expect(resolver.authenticate({ clientSecret: SECRET, authorization: basic('pre_basic', SECRET) })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('refuses a malformed Basic header', async () => {
    await expect(resolver.authenticate({ authorization: 'Basic !!!' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('refuses a secret client with no stored digest', async () => {
    repository.clients.set('pre_nohash', { ...POST_CLIENT, clientId: 'pre_nohash', secretHash: undefined });
    await expect(resolver.authenticate({ clientId: 'pre_nohash', clientSecret: SECRET })).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('OAuthClientResolver.recordUse', () => {
  it('extends a dynamic client by the configured lifetime', async () => {
    const at = DateTime.utc();
    const custom = new OAuthClientResolver(repository, new OAuthClientOptions(Duration.fromObject({ days: 10 })));

    await custom.recordUse(PUBLIC, at);

    expect(repository.touches).toEqual([{ clientId: 'dyn_public', at, extendTo: at.plus({ days: 10 }) }]);
  });

  it('touches a pre-registered client without an expiry', async () => {
    const at = DateTime.utc();
    await resolver.recordUse(POST_CLIENT, at);
    expect(repository.touches).toEqual([{ clientId: 'pre_post', at }]);
  });

  it('records nothing for a metadata-document client', async () => {
    await resolver.recordUse({ ...PUBLIC, kind: 'metadata_document' });
    expect(repository.touches).toEqual([]);
  });
});

describe('parseBasicClientCredentials', () => {
  it('form-decodes both halves', () => {
    expect(parseBasicClientCredentials(basic('client:with colon', 'se cret+/'))).toEqual({
      clientId: 'client:with colon',
      clientSecret: 'se cret+/',
    });
  });

  it.each([undefined, 'Bearer abc', 'Basic', `Basic ${Buffer.from('nocolon').toString('base64')}`])('answers undefined for %s', header => {
    expect(parseBasicClientCredentials(header)).toBeUndefined();
  });
});

describe('client secrets', () => {
  it('stores a SHA-256 hex digest that matches the secret', () => {
    const { secret, secretHash } = createOAuthClientSecret();

    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secretHash).toBe(hashOAuthClientSecret(secret));
    expect(secretHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
