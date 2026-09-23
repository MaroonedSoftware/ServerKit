import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { timingSafeCompare } from '../helpers.js';
import { ClientIdMetadataDocumentResolver, isClientIdMetadataDocumentUrl } from './client.id.metadata.document.resolver.js';
import { OAuthClientOptions } from './oauth.client.options.js';
import { OAuthClientRepository } from './oauth.client.repository.js';
import { hashOAuthClientSecret } from './oauth.client.secret.js';
import { OAuthError } from './oauth.error.js';
import type { OAuthClient } from './oauth.types.js';

/** What a token request offers to identify and authenticate its client. */
export interface OAuthClientCredentials {
  /** `client_id` from the request body. */
  clientId?: string;
  /** `client_secret` from the request body. */
  clientSecret?: string;
  /** The request's `Authorization` header, for `client_secret_basic`. */
  authorization?: string;
}

/**
 * Parse `Authorization: Basic` client credentials. Both halves are
 * form-urlencoded before encoding ([RFC 6749 §2.3.1](https://datatracker.ietf.org/doc/html/rfc6749#section-2.3.1)).
 * Answers `undefined` for anything that is not a well-formed Basic header.
 */
export const parseBasicClientCredentials = (authorization: string | undefined): { clientId: string; clientSecret: string } | undefined => {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(authorization ?? '');
  if (!match?.[1]) return undefined;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return undefined;
  const formDecode = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '));
  try {
    return { clientId: formDecode(decoded.slice(0, colon)), clientSecret: formDecode(decoded.slice(colon + 1)) };
  } catch {
    return undefined;
  }
};

/**
 * Finds and authenticates OAuth clients.
 *
 * A `client_id` that is an https URL is a Client ID Metadata Document, resolved
 * through {@link ClientIdMetadataDocumentResolver} when one is bound; anything
 * else comes from the {@link OAuthClientRepository}. An unknown or expired
 * client is `invalid_client`.
 */
@Injectable()
export class OAuthClientResolver {
  constructor(
    private readonly repository: OAuthClientRepository,
    private readonly options: OAuthClientOptions,
    /** Optional: without it, metadata-document clients are unknown clients. */
    private readonly metadataDocuments?: ClientIdMetadataDocumentResolver,
  ) {}

  /** Whether Client ID Metadata Documents are resolved, and so may be advertised. */
  get supportsMetadataDocuments(): boolean {
    return this.metadataDocuments !== undefined;
  }

  /**
   * The client with this id.
   *
   * @throws OAuthError `invalid_client` when it is unknown or expired, or its
   *   metadata document does not resolve.
   */
  async resolve(clientId: string): Promise<OAuthClient> {
    if (typeof clientId !== 'string' || clientId.length === 0) {
      throw new OAuthError('invalid_client', 'client_id is required');
    }

    if (this.metadataDocuments && isClientIdMetadataDocumentUrl(clientId)) {
      return await this.metadataDocuments.resolve(clientId);
    }

    const client = await this.repository.findByClientId(clientId);
    if (!client) {
      throw new OAuthError('invalid_client', 'unknown client');
    }
    if (client.expiresAt !== undefined && client.expiresAt <= DateTime.utc()) {
      throw new OAuthError('invalid_client', 'the client registration has expired');
    }
    return client;
  }

  /**
   * Identify and authenticate the client of a token request.
   *
   * The client id comes from the Basic header when one is sent, and from the
   * body otherwise; the two must agree when both are present. A public client
   * must present no secret. A `client_secret_post` client presents its secret in
   * the body, a `client_secret_basic` one in the header, and the SHA-256 digest
   * is compared in constant time.
   *
   * @throws OAuthError `invalid_client` (401, with a Basic challenge when the
   *   header was used) on any failure.
   */
  async authenticate(credentials: OAuthClientCredentials): Promise<OAuthClient> {
    const usedBasic = /^Basic\s/i.test(credentials.authorization ?? '');
    const basic = parseBasicClientCredentials(credentials.authorization);
    const fail = (description: string) => {
      const error = new OAuthError('invalid_client', description, 401);
      if (usedBasic) error.addHeader('WWW-Authenticate', 'Basic realm="oauth"');
      return error;
    };

    if (usedBasic && !basic) throw fail('the Authorization header is malformed');
    if (basic && credentials.clientId !== undefined && credentials.clientId !== basic.clientId) {
      throw fail('client_id does not match the Authorization header');
    }
    if (basic && credentials.clientSecret !== undefined) {
      throw fail('present client credentials in one place only');
    }

    const clientId = basic?.clientId ?? credentials.clientId;
    if (!clientId) throw fail('client_id is required');

    let client: OAuthClient;
    try {
      client = await this.resolve(clientId);
    } catch (error) {
      if (error instanceof OAuthError) throw fail(error.description);
      throw error;
    }

    const presented = basic?.clientSecret ?? credentials.clientSecret;
    switch (client.tokenEndpointAuthMethod) {
      case 'none':
        if (presented !== undefined) throw fail('a public client must not present a secret');
        return client;
      case 'client_secret_post':
        if (basic) throw fail('this client authenticates with client_secret in the body');
        break;
      case 'client_secret_basic':
        if (!basic) throw fail('this client authenticates with HTTP Basic');
        break;
    }

    if (presented === undefined || client.secretHash === undefined || !timingSafeCompare(hashOAuthClientSecret(presented), client.secretHash)) {
      throw fail('client authentication failed');
    }
    return client;
  }

  /**
   * Record a successful use of a client, extending a dynamic client's life. A
   * metadata-document client is not stored and has nothing to record.
   */
  async recordUse(client: OAuthClient, at: DateTime = DateTime.utc()): Promise<void> {
    if (client.kind === 'metadata_document') return;
    await this.repository.touchLastUsed(client.clientId, at, client.kind === 'dynamic' ? at.plus(this.options.dynamicClientLifetime) : undefined);
  }
}
