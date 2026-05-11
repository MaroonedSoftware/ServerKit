/**
 * Standard authorization-response payload as defined by OAuth 2.0
 * (RFC 6749 §4.1.2 / §4.1.2.1) plus the optional `iss` parameter from
 * RFC 9207. Callers parse this from the callback `query`, form body
 * (`response_mode=form_post`), or URL fragment and pass it to
 * {@link OAuth2FactorService.completeAuthorization} /
 * {@link OidcFactorService.completeAuthorization}.
 *
 * The standardized fields are typed; provider-specific extras (Google's
 * `hd` / `authuser` / `prompt`, Microsoft's `session_state`, etc.) pass
 * through untyped via the index signature so callers can log or forward
 * them without re-shaping the payload. The shape mirrors
 * `Object.fromEntries(new URLSearchParams(...))` so a Koa handler can
 * usually pass `ctx.query` straight through.
 */
export type AuthorizationCallbackParams = {
  /** Authorization code to exchange for tokens. Required on success. */
  code?: string;
  /** Opaque state value the client sent on the authorize request. */
  state?: string;
  /** Error code per RFC 6749 §4.1.2.1 / OIDC Core §3.1.2.6 when the IdP rejects the request. */
  error?: string;
  /** Human-readable explanation of the `error`. */
  error_description?: string;
  /** URL pointing to a page describing the `error`. */
  error_uri?: string;
  /** Issuer identifier per RFC 9207. When present, OIDC verifies it matches the discovered issuer. */
  iss?: string;
  /** Provider-specific extras pass through untyped. */
  [key: string]: string | undefined;
};
