# @maroonedsoftware/saml

## 0.1.0

### Minor Changes

- 09acbaf: New package `@maroonedsoftware/saml`: SAML 2.0 provider configuration and metadata on `@node-saml/node-saml`. `SamlProviderConfig`, a `SamlProviderSource` re-read on every lookup with a static `SamlProviderRegistryConfig`, and a `SamlProviderRegistry`; `parseIdpMetadata` reads an IdP's entity id, HTTP-Redirect SSO URL and signing certificates (with their expiry) and refuses metadata without signing certificates; `generateSpMetadata` produces the SP metadata for a provider. No sign-in yet.
