import { isPkceS256Challenge } from './pkce.s256.js';
import { redirectUriMatches } from './redirect.uri.js';
import type { AuthorizationRequest, OAuthClient, OAuthErrorCode } from './oauth.types.js';

/** An authorization request's query, as a router hands it over. A repeated parameter arrives as an array. */
export type AuthorizationRequestQuery = Record<string, string | string[] | undefined>;

/** What the server accepts, for {@link parseAuthorizationRequest}. */
export interface AuthorizationRequestPolicy {
  /** Every resource the server issues tokens for. A request must name one of them. */
  resources: readonly string[];
  /** Every scope the server advertises. */
  scopesSupported: readonly string[];
}

/**
 * The outcome of checking an authorization request.
 *
 * - `valid` — proceed to consent with `request`.
 * - `redirect` — the client and `redirect_uri` are trustworthy but something else
 *   is wrong: send the error back to `redirectUri` (RFC 6749 §4.1.2.1), with
 *   `state` and the issuer.
 * - `refuse` — the client or `redirect_uri` is not trustworthy: show the error to
 *   the user and **never** redirect, or the server becomes an open redirector.
 */
export type AuthorizationRequestParseResult =
  | { kind: 'valid'; request: AuthorizationRequest }
  | { kind: 'redirect'; redirectUri: string; error: OAuthErrorCode; description: string; state?: string }
  | { kind: 'refuse'; error: OAuthErrorCode; description: string };

/** A parameter's single value; `null` when it was repeated, which RFC 6749 §3.1 forbids. */
const single = (query: AuthorizationRequestQuery, name: string): string | undefined | null => {
  const value = query[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value === '' ? undefined : value;
};

/**
 * Check an authorization request against the client it names and the server's
 * policy.
 *
 * `client` is what the caller resolved from the request's `client_id`. The
 * `redirect_uri` is required and must match one the client registered. PKCE
 * `S256` and `response_type=code` are required. `resource` must be one of the
 * server's resources; when it is missing and the server has exactly one, that
 * one is used. Scope is advisory: unsupported scopes are dropped, and a request
 * for none (or for only unsupported ones) is granted every supported scope.
 */
export const parseAuthorizationRequest = (
  query: AuthorizationRequestQuery,
  client: OAuthClient,
  policy: AuthorizationRequestPolicy,
): AuthorizationRequestParseResult => {
  const refuse = (error: OAuthErrorCode, description: string): AuthorizationRequestParseResult => ({ kind: 'refuse', error, description });

  const clientId = single(query, 'client_id');
  if (clientId === null || clientId !== client.clientId) {
    return refuse('invalid_request', 'client_id is missing, repeated, or does not name this client');
  }

  const redirectUri = single(query, 'redirect_uri');
  if (redirectUri === null || redirectUri === undefined) {
    return refuse('invalid_request', 'redirect_uri is required');
  }
  if (!redirectUriMatches(client.redirectUris, redirectUri)) {
    return refuse('invalid_request', 'redirect_uri is not registered for this client');
  }

  // From here the redirect target is trusted, so errors go back to the client.
  const stateValue = single(query, 'state');
  const state = stateValue === null ? undefined : stateValue;
  const bounce = (error: OAuthErrorCode, description: string): AuthorizationRequestParseResult => ({
    kind: 'redirect',
    redirectUri,
    error,
    description,
    ...(state === undefined ? {} : { state }),
  });

  for (const name of ['state', 'response_type', 'code_challenge', 'code_challenge_method', 'resource', 'scope']) {
    if (single(query, name) === null) return bounce('invalid_request', `${name} must not be repeated`);
  }

  if (single(query, 'response_type') !== 'code') {
    return bounce('unsupported_response_type', 'response_type must be code');
  }

  const codeChallenge = single(query, 'code_challenge');
  if (!codeChallenge || !isPkceS256Challenge(codeChallenge)) {
    return bounce('invalid_request', 'an S256 code_challenge is required');
  }
  if (single(query, 'code_challenge_method') !== 'S256') {
    return bounce('invalid_request', 'code_challenge_method must be S256');
  }

  const requestedResource = single(query, 'resource') ?? undefined;
  const resource = requestedResource ?? (policy.resources.length === 1 ? policy.resources[0] : undefined);
  if (resource === undefined) {
    return bounce('invalid_target', 'resource is required');
  }
  if (!policy.resources.includes(resource)) {
    return bounce('invalid_target', 'resource is not served by this authorization server');
  }

  const requestedScopes = (single(query, 'scope') ?? '').split(' ').filter(scope => scope.length > 0);
  const granted = [...new Set(requestedScopes.filter(scope => policy.scopesSupported.includes(scope)))];
  const scope = granted.length > 0 ? granted : [...policy.scopesSupported];

  return {
    kind: 'valid',
    request: {
      clientId: client.clientId,
      redirectUri,
      responseType: 'code',
      codeChallenge,
      codeChallengeMethod: 'S256',
      ...(state === undefined ? {} : { state }),
      scope,
      resource,
    },
  };
};
