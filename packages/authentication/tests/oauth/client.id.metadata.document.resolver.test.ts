import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Duration } from 'luxon';
import {
  ClientIdMetadataDocumentResolver,
  ClientIdMetadataDocumentResolverOptions,
  isClientIdMetadataDocumentUrl,
} from '../../src/oauth/client.id.metadata.document.resolver.js';
import { makeCache } from './oauth.fakes.js';

const CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';

const DOCUMENT = {
  client_id: CLIENT_ID,
  client_name: 'Claude Code',
  redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
};

const jsonResponse = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

let cache: ReturnType<typeof makeCache>;
let fetchMock: ReturnType<typeof vi.fn>;

const makeResolver = (overrides: { allowHost?: (hostname: string) => boolean | Promise<boolean>; maxBytes?: number } = {}) =>
  new ClientIdMetadataDocumentResolver(
    cache,
    new ClientIdMetadataDocumentResolverOptions(
      fetchMock as unknown as typeof fetch,
      Duration.fromObject({ seconds: 5 }),
      overrides.maxBytes ?? 65_536,
      Duration.fromObject({ seconds: 60 }),
      Duration.fromObject({ hours: 24 }),
      overrides.allowHost,
    ),
  );

const cachedTtlSeconds = () => (vi.mocked(cache.set).mock.calls[0]?.[2] as Duration).as('seconds');

beforeEach(() => {
  cache = makeCache();
  fetchMock = vi.fn(async () => jsonResponse(DOCUMENT));
});

describe('ClientIdMetadataDocumentResolver', () => {
  it('fetches, validates, and returns a public metadata-document client', async () => {
    const client = await makeResolver().resolve(CLIENT_ID);

    expect(client).toEqual({
      clientId: CLIENT_ID,
      kind: 'metadata_document',
      clientName: 'Claude Code',
      redirectUris: DOCUMENT.redirect_uris,
      tokenEndpointAuthMethod: 'none',
    });
  });

  it('fetches without following redirects, asking for JSON, under a timeout', async () => {
    await makeResolver().resolve(CLIENT_ID);

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(CLIENT_ID);
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', headers: { accept: 'application/json' } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('serves a cached client without fetching again', async () => {
    const resolver = makeResolver();

    await resolver.resolve(CLIENT_ID);
    const again = await resolver.resolve(CLIENT_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.clientName).toBe('Claude Code');
    expect([...cache.store.keys()][0]).toMatch(/^oauth_cimd_[0-9a-f]{64}$/);
  });

  it.each([
    ['max-age inside the range', 'public, max-age=3600', 3600],
    ['max-age below the floor', 'max-age=5', 60],
    ['max-age above the ceiling', 'max-age=604800', 86_400],
    ['no-store', 'no-store', 60],
    ['no-cache with a max-age', 'no-cache, max-age=3600', 60],
    ['no header', undefined, 60],
  ])('caches for %s', async (_label, cacheControl, expected) => {
    fetchMock.mockResolvedValue(jsonResponse(DOCUMENT, cacheControl === undefined ? {} : { 'cache-control': cacheControl }));

    await makeResolver().resolve(CLIENT_ID);

    expect(cachedTtlSeconds()).toBe(expected);
  });

  it('accepts a +json content type with parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(DOCUMENT, { 'content-type': 'application/oauth-client+json; charset=utf-8' }));
    await expect(makeResolver().resolve(CLIENT_ID)).resolves.toBeDefined();
  });

  it('drops malformed cosmetic fields rather than refusing the client', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...DOCUMENT, logo_uri: 'http://insecure/logo.png', client_uri: 'https://claude.ai' }));

    const client = await makeResolver().resolve(CLIENT_ID);

    expect(client.logoUri).toBeUndefined();
    expect(client.clientUri).toBe('https://claude.ai');
  });

  describe('refuses the client id', () => {
    it.each([
      ['an http URL', 'http://claude.ai/oauth/client'],
      ['a root path', 'https://claude.ai/'],
      ['a query', 'https://claude.ai/oauth/client?x=1'],
      ['a fragment', 'https://claude.ai/oauth/client#x'],
      ['userinfo', 'https://user@claude.ai/oauth/client'],
      ['an IPv4 host', 'https://203.0.113.9/oauth/client'],
      ['an IPv6 host', 'https://[2001:db8::1]/oauth/client'],
      ['localhost', 'https://localhost/oauth/client'],
      ['a .localhost name', 'https://app.localhost/oauth/client'],
      ['a non-normalised spelling', 'https://CLAUDE.ai/oauth/client'],
      ['a non-URL', 'claude-code'],
    ])('with %s, without fetching', async (_label, clientId) => {
      await expect(makeResolver().resolve(clientId)).rejects.toMatchObject({ code: 'invalid_client' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('when the host is not allowed, before consulting the cache', async () => {
      const allowHost = vi.fn(async (hostname: string) => hostname === 'example.com');
      await makeResolver().resolve(CLIENT_ID);

      await expect(makeResolver({ allowHost }).resolve(CLIENT_ID)).rejects.toMatchObject({ code: 'invalid_client' });
      expect(allowHost).toHaveBeenCalledWith('claude.ai');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('refuses the document', () => {
    it.each([
      ['that names another client_id', jsonResponse({ ...DOCUMENT, client_id: 'https://evil.example/client' })],
      ['whose client_id differs by a trailing slash', jsonResponse({ ...DOCUMENT, client_id: `${CLIENT_ID}/` })],
      ['with no redirect_uris', jsonResponse({ ...DOCUMENT, redirect_uris: undefined })],
      ['with an http non-loopback redirect URI', jsonResponse({ ...DOCUMENT, redirect_uris: ['http://evil.example/cb'] })],
      ['for a confidential client', jsonResponse({ ...DOCUMENT, token_endpoint_auth_method: 'client_secret_basic' })],
      ['that is not an object', jsonResponse(['not', 'an', 'object'])],
      ['with a non-JSON content type', new Response(JSON.stringify(DOCUMENT), { headers: { 'content-type': 'text/html' } })],
      ['that is not valid JSON', new Response('{ nope', { headers: { 'content-type': 'application/json' } })],
      ['from an error status', jsonResponse(DOCUMENT, {}, 404)],
      ['declared too large by content-length', jsonResponse(DOCUMENT, { 'content-length': '70000' })],
    ])('%s', async (_label, response) => {
      fetchMock.mockResolvedValue(response);

      await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({ code: 'invalid_client' });
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('that streams past the size limit with no content-length', async () => {
      const chunk = new TextEncoder().encode('x'.repeat(1024));
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls > 1000) controller.close();
          else controller.enqueue(chunk);
        },
      });
      fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } }));

      await expect(makeResolver({ maxBytes: 4096 }).resolve(CLIENT_ID)).rejects.toMatchObject({
        code: 'invalid_client',
        description: 'the client metadata document is too large',
      });
      expect(pulls).toBeLessThan(10);
    });

    it('when the fetch fails, as a refused redirect or a timeout does', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed: redirect mode is set to error'));
      await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({ code: 'invalid_client' });

      fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({ code: 'invalid_client' });
    });
  });
});

describe('isClientIdMetadataDocumentUrl', () => {
  it('recognises https client ids only', () => {
    expect(isClientIdMetadataDocumentUrl(CLIENT_ID)).toBe(true);
    expect(isClientIdMetadataDocumentUrl('dyn_abc')).toBe(false);
    expect(isClientIdMetadataDocumentUrl('http://claude.ai/x')).toBe(false);
  });
});
