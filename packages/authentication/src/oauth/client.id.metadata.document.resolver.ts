import crypto from 'node:crypto';
import net from 'node:net';
import { Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { CacheProvider } from '@maroonedsoftware/cache';
import { OAuthError } from './oauth.error.js';
import type { OAuthClient } from './oauth.types.js';
import { validateRegisteredRedirectUri } from './redirect.uri.js';

/** Most redirect URIs a metadata document may declare. */
const MAX_REDIRECT_URIS = 20;
/** Longest `client_name` kept. */
const MAX_CLIENT_NAME_LENGTH = 200;

/** Settings for {@link ClientIdMetadataDocumentResolver}. */
@Injectable()
export class ClientIdMetadataDocumentResolverOptions {
  constructor(
    /** The fetch implementation. Replace it in tests; in production leave the global. */
    public readonly fetch: typeof globalThis.fetch = globalThis.fetch,
    /** Budget for fetching one document, body included. Claude allows 10 seconds for the whole authorize step. */
    public readonly timeout: Duration = Duration.fromObject({ seconds: 5 }),
    /** Largest document accepted, in bytes. */
    public readonly maxBytes: number = 65_536,
    /**
     * Shortest a document is cached, whatever its `Cache-Control` says. The floor
     * is the defence against a client that asks not to be cached so every
     * authorization triggers a fetch.
     */
    public readonly minCacheTtl: Duration = Duration.fromObject({ seconds: 60 }),
    /** Longest a document is cached. */
    public readonly maxCacheTtl: Duration = Duration.fromObject({ hours: 24 }),
    /**
     * The operator's control over which hosts may identify clients. Called with
     * the client id's hostname on every resolution, before the cache. Absent
     * means any public https host.
     */
    public readonly allowHost?: (hostname: string) => boolean | Promise<boolean>,
  ) {}
}

/** `true` for a `client_id` that is a URL, and so names a metadata document rather than a stored client. */
export const isClientIdMetadataDocumentUrl = (clientId: string): boolean => clientId.startsWith('https://');

const refuse = (description: string) => new OAuthError('invalid_client', description);

/** `max-age` from a `Cache-Control` header, or `undefined` when the response asks not to be cached or says nothing. */
const maxAgeOf = (cacheControl: string | null): number | undefined => {
  if (!cacheControl || /(?:^|,)\s*(?:no-store|no-cache)\s*(?:,|$)/i.test(cacheControl)) return undefined;
  const match = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(cacheControl);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

/**
 * Resolves Client ID Metadata Documents: a `client_id` that is an https URL
 * names a JSON document describing the client, which this resolver fetches,
 * validates, and caches. Claude Code identifies itself this way.
 *
 * The URL must be `https:` with a path, no query, fragment, or userinfo, and a
 * hostname that is neither an IP literal nor `localhost`, and it must pass
 * {@link ClientIdMetadataDocumentResolverOptions.allowHost}. The document must
 * be JSON no larger than `maxBytes`, fetched without following redirects, whose
 * `client_id` equals the URL exactly and whose `redirect_uris` are acceptable.
 * The validated client is cached for the response's `max-age`, clamped between
 * `minCacheTtl` and `maxCacheTtl`.
 *
 * DNS rebinding is **not** defended: the hostname is checked, not the address
 * it resolves to, so a public name pointing at a private address is fetched.
 * `allowHost` is the operator's control; restrict it where that matters.
 */
@Injectable()
export class ClientIdMetadataDocumentResolver {
  constructor(
    private readonly cache: CacheProvider,
    private readonly options: ClientIdMetadataDocumentResolverOptions,
  ) {}

  /**
   * The client a metadata-document `client_id` describes.
   *
   * @throws OAuthError `invalid_client` when the URL is not acceptable, the host is
   *   not allowed, the document cannot be fetched, or it does not validate.
   */
  async resolve(clientId: string): Promise<OAuthClient> {
    const url = this.checkUrl(clientId);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (this.options.allowHost && !(await this.options.allowHost(hostname))) {
      throw refuse('this client id host is not allowed');
    }

    const key = `oauth_cimd_${crypto.createHash('sha256').update(clientId).digest('hex')}`;
    const cached = await this.cache.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as OAuthClient;
    }

    const { document, maxAge } = await this.fetchDocument(clientId);
    const client = this.toClient(clientId, document);

    const seconds = Math.min(Math.max(maxAge ?? 0, this.options.minCacheTtl.as('seconds')), this.options.maxCacheTtl.as('seconds'));
    await this.cache.set(key, JSON.stringify(client), Duration.fromObject({ seconds }));
    return client;
  }

  private checkUrl(clientId: string): URL {
    let url: URL;
    try {
      url = new URL(clientId);
    } catch {
      throw refuse('the client id is not a URL');
    }
    // One spelling per document: a client id that normalises differently would
    // otherwise occupy a second cache entry, and must equal the document's own.
    if (url.href !== clientId) throw refuse('the client id must be a normalised URL');
    if (url.protocol !== 'https:') throw refuse('the client id must be an https URL');
    if (url.pathname === '/' || url.pathname === '') throw refuse('the client id must have a path');
    if (url.search !== '' || url.hash !== '' || clientId.includes('?') || clientId.includes('#')) {
      throw refuse('the client id must not have a query or fragment');
    }
    if (url.username !== '' || url.password !== '') throw refuse('the client id must not carry credentials');

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(hostname) !== 0) throw refuse('the client id host must be a name, not an address');
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw refuse('the client id host must not be localhost');
    return url;
  }

  private async fetchDocument(clientId: string): Promise<{ document: unknown; maxAge: number | undefined }> {
    const fetchImpl = this.options.fetch;
    let response: Response;
    try {
      response = await fetchImpl(clientId, {
        method: 'GET',
        // A redirect would be fetched without the checks above, so none is followed.
        redirect: 'error',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeout.as('milliseconds')),
      });
    } catch {
      throw refuse('the client metadata document could not be fetched');
    }

    try {
      if (!response.ok) throw refuse(`the client metadata document answered ${response.status}`);

      const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      if (contentType !== 'application/json' && !contentType.endsWith('+json')) {
        throw refuse('the client metadata document is not JSON');
      }

      const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN);
      if (Number.isFinite(declaredLength) && declaredLength > this.options.maxBytes) {
        throw refuse('the client metadata document is too large');
      }

      const text = await this.readCapped(response);
      let document: unknown;
      try {
        document = JSON.parse(text);
      } catch {
        throw refuse('the client metadata document is not valid JSON');
      }
      return { document, maxAge: maxAgeOf(response.headers.get('cache-control')) };
    } catch (error) {
      await response.body?.cancel().catch(() => undefined);
      throw error;
    }
  }

  private async readCapped(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.options.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw refuse('the client metadata document is too large');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      throw refuse('the client metadata document could not be read');
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }

  private toClient(clientId: string, document: unknown): OAuthClient {
    if (typeof document !== 'object' || document === null || Array.isArray(document)) {
      throw refuse('the client metadata document must be a JSON object');
    }
    const doc = document as Record<string, unknown>;

    if (doc.client_id !== clientId) {
      throw refuse('the client metadata document names a different client_id');
    }

    const redirectUris = doc.redirect_uris;
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      redirectUris.length > MAX_REDIRECT_URIS ||
      !redirectUris.every(uri => typeof uri === 'string' && validateRegisteredRedirectUri(uri) === undefined)
    ) {
      throw refuse('the client metadata document must declare acceptable redirect_uris');
    }

    if ((doc.token_endpoint_auth_method ?? 'none') !== 'none') {
      throw refuse('a client identified by a metadata document must be a public client');
    }

    // Cosmetic fields are kept when well-formed and dropped otherwise: they only
    // decorate the consent screen, and refusing a client over a logo is unkind.
    const httpsOrUndefined = (value: unknown) => {
      if (typeof value !== 'string') return undefined;
      try {
        return new URL(value).protocol === 'https:' ? value : undefined;
      } catch {
        return undefined;
      }
    };
    const clientName =
      typeof doc.client_name === 'string' && doc.client_name.length > 0 ? doc.client_name.slice(0, MAX_CLIENT_NAME_LENGTH) : undefined;
    const clientUri = httpsOrUndefined(doc.client_uri);
    const logoUri = httpsOrUndefined(doc.logo_uri);

    return {
      clientId,
      kind: 'metadata_document',
      redirectUris: [...new Set(redirectUris as string[])],
      tokenEndpointAuthMethod: 'none',
      ...(clientName === undefined ? {} : { clientName }),
      ...(clientUri === undefined ? {} : { clientUri }),
      ...(logoUri === undefined ? {} : { logoUri }),
    };
  }
}
