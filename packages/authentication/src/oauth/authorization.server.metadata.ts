/** The inputs to {@link buildAuthorizationServerMetadata}. */
export interface AuthorizationServerMetadataInput {
  /** The issuer identifier: an `https:` URL with no query or fragment. */
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Advertised only when set, which is how a server says Dynamic Client Registration is on. */
  registrationEndpoint?: string;
  scopesSupported: readonly string[];
  /**
   * Advertise Client ID Metadata Documents. Claude Code chooses them whenever
   * this is advertised alongside the `none` auth method, so set it only when a
   * resolver for them is bound.
   */
  clientIdMetadataDocumentSupported: boolean;
}

/** Authorization server metadata ([RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414)), in wire names. */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  response_types_supported: ['code'];
  grant_types_supported: ['authorization_code', 'refresh_token'];
  code_challenge_methods_supported: ['S256'];
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'];
  scopes_supported: string[];
  client_id_metadata_document_supported: boolean;
  authorization_response_iss_parameter_supported: true;
  resource_indicators_supported: true;
}

/**
 * Build the authorization server metadata document served at
 * `/.well-known/oauth-authorization-server`.
 *
 * The capabilities are fixed by what this package implements: the
 * authorization code grant with PKCE `S256`, refresh tokens, public and
 * secret-based clients, RFC 9207 `iss` on every authorization response, and
 * RFC 8707 resource indicators.
 */
export const buildAuthorizationServerMetadata = (input: AuthorizationServerMetadataInput): AuthorizationServerMetadata => ({
  issuer: input.issuer,
  authorization_endpoint: input.authorizationEndpoint,
  token_endpoint: input.tokenEndpoint,
  ...(input.registrationEndpoint === undefined ? {} : { registration_endpoint: input.registrationEndpoint }),
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
  scopes_supported: [...input.scopesSupported],
  client_id_metadata_document_supported: input.clientIdMetadataDocumentSupported,
  authorization_response_iss_parameter_supported: true,
  resource_indicators_supported: true,
});

/**
 * Insert a well-known suffix between an identifier's origin and its path, the
 * way RFC 8414 §3.1 and RFC 9728 §3.1 construct metadata URLs.
 */
export const wellKnownUrl = (identifier: string, suffix: string): string => {
  const url = new URL(identifier);
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return `${url.origin}/.well-known/${suffix}${path}`;
};

/**
 * Where an issuer's metadata lives: `https://host/.well-known/oauth-authorization-server`
 * for an issuer at the origin, with the issuer's path appended otherwise.
 */
export const authorizationServerMetadataUrl = (issuer: string): string => wellKnownUrl(issuer, 'oauth-authorization-server');
