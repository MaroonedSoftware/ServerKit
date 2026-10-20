# @maroonedsoftware/saml

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
