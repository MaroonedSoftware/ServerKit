---
'@maroonedsoftware/authentication': major
---

OIDC providers from a runtime source, sessions bound to an audience, and an OAuth 2.1 authorization server for MCP clients.

**Breaking changes**

- `OidcProviderRegistry` reads providers from an `OidcProviderSource` on every lookup, and its
  constructor takes the source: `new OidcProviderRegistry(source, logger)`.
  `OidcProviderRegistryConfig` now extends `OidcProviderSource` and stays the static default, so
  register it under the `OidcProviderSource` token. `getConfig`, `isPublicClient`, and
  `listProviders` are now async. Discovery is cached under a fingerprint of the issuer, client id,
  client secret, and `allowInsecureIssuer`, so a rotated secret rediscovers and a removed provider
  404s.
- Every `OidcAuthorizationResult` carries `intent`. A `link` whose `(provider, subject)` belongs to
  another account now throws a 409 and records `oidc.link.rejected` with reason `subject_taken`.
  It no longer returns `signed-in` for the other account.
- `lookupSessionFromJwt` refuses a refresh token presented as an access token, and records reason
  `refresh_token_presented`. Before this, a refresh token was accepted as an access token for its
  whole lifetime.
- `SessionValidationFailureReason` and `FederatedLinkRejectedReason` gain members. An exhaustive
  switch over them needs the new cases.

**Sessions carry an audience**

- `createSession(..., device?, audience?)` binds every token the session issues to that audience.
  The audience is carried through the cache and across rotation.
- `lookupSessionFromJwt(jwt, ignoreExpiration?, expectedAudience?)` and
  `refreshSession(token, expectedAudience?, guard?)` check the token's `aud` against the expected
  audience, or the configured one when none is given. A mismatch is a 401 with reason
  `audience_mismatch`, refused before the cache is read. A token issued for one resource is
  therefore refused by every route that does not ask for it.
- `refreshSession`'s `guard` runs after the refresh token is claimed and before new tokens are
  minted. It binds a refresh to more than possession of the token.

**OAuth 2.1 authorization server (`src/oauth/`)**

- `OAuthAuthorizationServer` is a facade over the pieces below. It serves metadata, validates and
  stashes authorization requests for consent, approves or denies them, registers clients, and
  answers the token endpoint. The consuming app owns the routes and the consent page.
- The authorization code grant with PKCE `S256` issues single-use 60-second codes, bound to the
  client, the exact `redirect_uri`, and the resource. Refresh tokens rotate and are bound to their
  client and grant. Every authorization response carries RFC 9207 `iss`.
- Clients come from three places: an `OAuthClientRepository` you implement (pre-registered and
  dynamic clients), Dynamic Client Registration (RFC 7591, public clients that expire after disuse),
  and Client ID Metadata Documents (fetched without redirects, size-capped, and cached).
- A code exchange mints an ordinary session for the consenting user. Its audience is the resource
  and it carries `claims.oauth`, which `getOAuthSessionClaim` reads. Grants are optional through
  `OAuthGrantRepository`.
- RFC 8414 and RFC 9728 metadata builders, redirect URI rules (a loopback redirect matches on any
  port), `OAuthError` (an `HttpError` with `toBody()`), and six new `oauth.*` audit events.
