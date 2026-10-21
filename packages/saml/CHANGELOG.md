# @maroonedsoftware/saml

## 0.3.0

### Minor Changes

- f044b55: **Breaking:** `SamlFactorService.completeAuthorization` now requires `expectedRequestId`, the `requestId` that `beginAuthorization` returned to this browser. Keep it in a cookie (`SameSite=None; Secure`, since the ACS post is cross-site) or the session. A response answering any other request is refused with a 400 (`details.InResponseTo: 'not the expected request'`, audit reason `unsolicited`) before that request is consumed, which stops login CSRF and linking a victim's identity to an attacker's account. When the browser has no stored id, refuse the post or restart the flow.

### Patch Changes

- ab5d46d: Consume single-use cache entries atomically in the OIDC and SAML factors. The OIDC state record, the SAML request record, the pending `new-user` authorization (`createFactorFromAuthorization`), and the authenticated exchange (`redeemAuthenticatedExchange`) are now read with `CacheProvider.take` instead of a `get` followed by a `delete`, so two concurrent requests can no longer both redeem the same entry. Requires a `CacheProvider` that implements `take` (Redis 6.2+ for `IoRedisCacheProvider`).
- 9c62bf3: Document what apps must enforce around `SamlFactorService` and `OidcFactorService`.

  - New "Caller responsibilities" sections: bind the `requestId` (SAML) or `state` (OIDC) returned by `beginAuthorization` to the browser that started the flow and refuse a callback it did not start, check `result.actorId` against the current session on `linked` and `stepped-up` results, and allow-list `redirectAfter`, which is returned unvalidated.
  - `SamlProfile.subject` no longer claims to be stable per end-user: under the default `emailAddress` NameID format a reassigned mailbox inherits the old factor. The README recommends the `persistent` format.

- Updated dependencies [6993312]
- Updated dependencies [4500bab]
- Updated dependencies [691b176]
- Updated dependencies [ab5d46d]
- Updated dependencies [6d74f67]
- Updated dependencies [44cbc0e]
- Updated dependencies [a3205b1]
- Updated dependencies [9c62bf3]
- Updated dependencies [df15d43]
  - @maroonedsoftware/authentication@6.7.0
  - @maroonedsoftware/cache@0.6.0

## 0.2.0

### Minor Changes

- bafd84f: `@maroonedsoftware/saml`: SP-initiated SAML sign-in as an authentication factor. `SamlFactorService.beginAuthorization` builds an HTTP-Redirect AuthnRequest (with `ForceAuthn` for step-up and the provider's accepted `AuthnContextClassRef`s), and `completeAuthorization` validates the posted response and resolves `(provider, NameID)` to `signed-in`, `linked`, `new-user` or `stepped-up`, as the OIDC factor does. Every check is on and cannot be turned off: `InResponseTo` against a request the service issued (held in the cache), the assertion signature against the provider's certificates (several, for rotation) with SHA-1 refused, issuer, audience, destination and recipient, `NotBefore`/`NotOnOrAfter` within a configurable clock skew, and a replay store that accepts each assertion `ID` once until it expires. The `SamlProfile` carries the NameID, email, name, `authnContextClassRef`, `authnInstant` and `sessionIndex`. `SamlProviderConfig` gains `trustEmail` (the only way an asserted address can auto-link, since SAML has no `email_verified`) and `attributeNames`. Also `SamlFactorRepository`, `SamlActorEmailLookup`, the `auth.factor.saml.profile.allowed` policy, and the one-time authenticated exchange. The package now depends on `@maroonedsoftware/authentication`, `@maroonedsoftware/cache` and `@maroonedsoftware/policies`.

  `@maroonedsoftware/authentication`: `saml.*` audit events (the SAML counterparts of `oidc.*`) and the `unsolicited`, `assertion_invalid` and `assertion_replayed` failure reasons; `Factor` and `FactorRepository` are now exported from the package root.

### Patch Changes

- Updated dependencies [bafd84f]
  - @maroonedsoftware/authentication@6.6.0

## 0.1.0

### Minor Changes

- 09acbaf: New package `@maroonedsoftware/saml`: SAML 2.0 provider configuration and metadata on `@node-saml/node-saml`. `SamlProviderConfig`, a `SamlProviderSource` re-read on every lookup with a static `SamlProviderRegistryConfig`, and a `SamlProviderRegistry`; `parseIdpMetadata` reads an IdP's entity id, HTTP-Redirect SSO URL and signing certificates (with their expiry) and refuses metadata without signing certificates; `generateSpMetadata` produces the SP metadata for a provider. No sign-in yet.
