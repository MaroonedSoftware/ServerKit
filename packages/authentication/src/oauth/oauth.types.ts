import type { DateTime } from 'luxon';

/**
 * How an OAuth client came to be known to the authorization server.
 *
 * - `preregistered` — created by an operator, optionally with a secret.
 * - `dynamic` — registered by the client itself through Dynamic Client
 *   Registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)).
 *   Public, and expires after a period of disuse.
 * - `metadata_document` — identified by an https URL whose JSON document
 *   describes it (a Client ID Metadata Document). Never stored.
 */
export type OAuthClientKind = 'preregistered' | 'dynamic' | 'metadata_document';

/** How a client authenticates at the token endpoint. `none` is a public client. */
export type OAuthTokenEndpointAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

/** A client the authorization server will issue codes and tokens to. */
export interface OAuthClient {
  /** The `client_id`. A URL for a `metadata_document` client. */
  clientId: string;
  kind: OAuthClientKind;
  /** Display name for the consent screen. Supplied by the client, so untrusted. */
  clientName?: string;
  /** Every redirect URI the client may use. Matched exactly, loopback ports aside. */
  redirectUris: string[];
  tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
  /** SHA-256 hex digest of the client secret, for the two secret methods. Never the secret. */
  secretHash?: string;
  /** Home page the client claims. Supplied by the client, so untrusted. */
  clientUri?: string;
  /** Logo the client claims. Supplied by the client, so untrusted. */
  logoUri?: string;
  /** When a `dynamic` client stops resolving. Absent means it does not expire. */
  expiresAt?: DateTime;
}

/**
 * An authorization request that has been validated against its client, in the
 * shape the rest of the flow carries. PKCE `S256` and `response_type=code` are
 * the only modes supported.
 */
export interface AuthorizationRequest {
  clientId: string;
  /** The exact `redirect_uri` the client presented; the code is bound to it. */
  redirectUri: string;
  responseType: 'code';
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  /** Opaque client state, echoed on the redirect. */
  state?: string;
  /** Granted scopes: the requested ones the server supports, or all supported ones when none were requested. */
  scope: string[];
  /** The resource ([RFC 8707](https://datatracker.ietf.org/doc/html/rfc8707)) the tokens will be bound to. */
  resource: string;
}

/**
 * A token request as it arrives, in wire names. Every value is a string, from a
 * form or a JSON body alike.
 */
export type TokenRequest =
  | {
      grant_type: 'authorization_code';
      code: string;
      redirect_uri: string;
      code_verifier: string;
      client_id?: string;
      client_secret?: string;
      resource?: string;
    }
  | {
      grant_type: 'refresh_token';
      refresh_token: string;
      client_id?: string;
      client_secret?: string;
      scope?: string;
      resource?: string;
    };

/** A successful token response ([RFC 6749 §5.1](https://datatracker.ietf.org/doc/html/rfc6749#section-5.1)), in wire names. */
export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  /** Seconds until the access token expires. */
  expires_in: number;
  refresh_token?: string;
  /** Space-separated granted scopes. */
  scope: string;
}

/**
 * The OAuth error codes this package produces: RFC 6749 §4.1.2.1 and §5.2, plus
 * `invalid_target` (RFC 8707) and the two registration codes (RFC 7591 §3.2.2).
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'invalid_client_metadata'
  | 'invalid_redirect_uri'
  | 'access_denied'
  | 'server_error';
