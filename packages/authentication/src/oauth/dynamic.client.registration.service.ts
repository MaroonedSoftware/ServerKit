import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { AuditRecorder } from '../audit/audit.recorder.js';
import { OAuthClientOptions } from './oauth.client.options.js';
import { OAuthClientRepository } from './oauth.client.repository.js';
import { OAuthError } from './oauth.error.js';
import type { OAuthClient } from './oauth.types.js';
import { validateRegisteredRedirectUri } from './redirect.uri.js';

/** Longest `client_name` accepted. */
const MAX_CLIENT_NAME_LENGTH = 200;
/** Longest URI accepted in any metadata field. */
const MAX_URI_LENGTH = 2048;

const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
const SUPPORTED_RESPONSE_TYPES = ['code'];

/** The registration response ([RFC 7591 §3.2.1](https://datatracker.ietf.org/doc/html/rfc7591#section-3.2.1)), in wire names. */
export interface DynamicClientRegistrationResponse {
  client_id: string;
  client_id_issued_at: number;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: 'none';
  grant_types: string[];
  response_types: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const invalidMetadata = (description: string) => new OAuthError('invalid_client_metadata', description);

/** An optional string field, refused when present with the wrong type or length. */
const optionalString = (body: Record<string, unknown>, field: string, max: number): string | undefined => {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw invalidMetadata(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value;
};

/** An optional https URI, refused when present and not one. */
const optionalHttpsUri = (body: Record<string, unknown>, field: string): string | undefined => {
  const value = optionalString(body, field, MAX_URI_LENGTH);
  if (value === undefined) return undefined;
  try {
    if (new URL(value).protocol === 'https:') return value;
  } catch {
    // fall through to the refusal
  }
  throw invalidMetadata(`${field} must be an https URI`);
};

/** An optional list drawn from `supported`, defaulting when absent. */
const optionalSubset = (body: Record<string, unknown>, field: string, supported: string[], fallback: string[]): string[] => {
  const value = body[field];
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length === 0 || !value.every(entry => typeof entry === 'string' && supported.includes(entry))) {
    throw invalidMetadata(`${field} must be a non-empty subset of ${supported.join(', ')}`);
  }
  return [...new Set(value as string[])];
};

/**
 * Dynamic Client Registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591))
 * for public clients.
 *
 * Only public clients (`token_endpoint_auth_method: 'none'`) using the
 * authorization code grant can register; every registered client expires
 * {@link OAuthClientOptions.dynamicClientLifetime} after it was last used.
 * The consumer owns the route: parse the JSON body, call {@link register},
 * answer 201 with `response`, and render an {@link OAuthError} as its RFC body.
 */
@Injectable()
export class DynamicClientRegistrationService {
  constructor(
    private readonly repository: OAuthClientRepository,
    private readonly options: OAuthClientOptions,
    private readonly audit: AuditRecorder = new AuditRecorder(),
  ) {}

  /**
   * Validate a registration request and store the client.
   *
   * @param body - The parsed JSON request body, untrusted.
   * @returns The stored client and the RFC 7591 response to send.
   * @throws OAuthError `invalid_redirect_uri` when a redirect URI is missing or
   *   unacceptable, `invalid_client_metadata` for anything else malformed.
   */
  async register(body: unknown): Promise<{ client: OAuthClient; response: DynamicClientRegistrationResponse }> {
    if (!isRecord(body)) {
      throw invalidMetadata('the registration request must be a JSON object');
    }

    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris is required');
    }
    if (redirectUris.length > this.options.maxRedirectUris) {
      throw new OAuthError('invalid_redirect_uri', `at most ${this.options.maxRedirectUris} redirect_uris may be registered`);
    }
    for (const uri of redirectUris) {
      if (typeof uri !== 'string' || uri.length > MAX_URI_LENGTH || validateRegisteredRedirectUri(uri) !== undefined) {
        throw new OAuthError('invalid_redirect_uri', 'each redirect URI must be an https URI or an http loopback URI, without a fragment');
      }
    }

    const authMethod = body.token_endpoint_auth_method ?? 'none';
    if (authMethod !== 'none') {
      throw invalidMetadata('only public clients may register: token_endpoint_auth_method must be none');
    }

    const grantTypes = optionalSubset(body, 'grant_types', SUPPORTED_GRANT_TYPES, ['authorization_code', 'refresh_token']);
    if (!grantTypes.includes('authorization_code')) {
      throw invalidMetadata('grant_types must include authorization_code');
    }
    const responseTypes = optionalSubset(body, 'response_types', SUPPORTED_RESPONSE_TYPES, ['code']);

    const clientName = optionalString(body, 'client_name', MAX_CLIENT_NAME_LENGTH);
    const clientUri = optionalHttpsUri(body, 'client_uri');
    const logoUri = optionalHttpsUri(body, 'logo_uri');

    const now = DateTime.utc();
    const client: OAuthClient = {
      clientId: `${this.options.dynamicClientIdPrefix}_${crypto.randomBytes(32).toString('base64url')}`,
      kind: 'dynamic',
      redirectUris: [...new Set(redirectUris as string[])],
      tokenEndpointAuthMethod: 'none',
      expiresAt: now.plus(this.options.dynamicClientLifetime),
      ...(clientName === undefined ? {} : { clientName }),
      ...(clientUri === undefined ? {} : { clientUri }),
      ...(logoUri === undefined ? {} : { logoUri }),
    };

    const stored = await this.repository.create(client);

    await this.audit.record({
      type: 'oauth.client.registered',
      category: 'credential',
      outcome: 'success',
      data: {
        clientId: stored.clientId,
        redirectUris: stored.redirectUris,
        ...(stored.clientName === undefined ? {} : { clientName: stored.clientName }),
      },
    });

    return {
      client: stored,
      response: {
        client_id: stored.clientId,
        client_id_issued_at: now.toUnixInteger(),
        ...(stored.clientName === undefined ? {} : { client_name: stored.clientName }),
        ...(stored.clientUri === undefined ? {} : { client_uri: stored.clientUri }),
        ...(stored.logoUri === undefined ? {} : { logo_uri: stored.logoUri }),
        redirect_uris: stored.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: grantTypes,
        response_types: responseTypes,
      },
    };
  }
}
