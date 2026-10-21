# AGENTS.md — @maroonedsoftware/saml

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

SAML 2.0 service provider on `@node-saml/node-saml`: a per-provider config, a pluggable provider
source and registry, IdP metadata parsing, SP metadata generation, and SP-initiated sign-in as an
authentication factor (`SamlFactorService`) shaped like `authentication`'s `OidcFactorService`.
It is separate from `authentication` to keep the XML dependency tree out of apps that do not need it.
Framework-free: there is no transport; an ACS route passes the posted form to the service.

## Install

```bash
pnpm add @maroonedsoftware/saml
```

No peers. Runtime dependencies: `@maroonedsoftware/authentication`, `@maroonedsoftware/cache`,
`@maroonedsoftware/errors`, `@maroonedsoftware/policies`, `@node-saml/node-saml`, `@xmldom/xmldom`,
`injectkit`, `luxon`.

## Position in the graph

- **Depends on:** `authentication` (factor repository shape, `AuditRecorder` and the `saml.*`
  audit events), `cache`, `errors`, `policies`.
- **Depended on by:** nothing internal.
- **Subpath exports:** none.

## API surface

| Export                                                                                                                   | Kind           | Shape                                                                                                                                                                                                                                                                                                     | Notes                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `SamlProviderConfig`                                                                                                     | type           | `{ name, spEntityId, acsUrl: URL, idpEntityId, idpSsoUrl: URL, idpSigningCertificates, spDecryption?, acceptedAuthnContexts?, nameIdFormat?, attributeNames?, trustEmail? }`                                                                                                                              | `idpSigningCertificates` is PEM or bare base64, a list for rotation, never empty.                         |
| `SamlSpDecryption`                                                                                                       | type           | `{ privateKey: string; certificate: string }`                                                                                                                                                                                                                                                             | The SP's encryption key pair; the certificate goes in the SP metadata.                                    |
| `DEFAULT_SAML_NAME_ID_FORMAT`                                                                                            | constant       | `'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'`                                                                                                                                                                                                                                                | Used when `nameIdFormat` is unset.                                                                        |
| `SamlProviderSource`                                                                                                     | abstract class | `list(): Promise<readonly SamlProviderConfig[]> \| readonly SamlProviderConfig[]`                                                                                                                                                                                                                         | DI token. Re-read on every lookup; first entry wins on a duplicate name.                                  |
| `SamlProviderRegistryConfig`                                                                                             | class          | `new (providers?: SamlProviderConfig[])`                                                                                                                                                                                                                                                                  | Static source. Register with `.useValue(...)` under `SamlProviderSource`.                                 |
| `SamlProviderRegistry`                                                                                                   | class          | `getConfig(name): Promise<SamlProviderConfig>`, `listProviders(): Promise<string[]>`                                                                                                                                                                                                                      | `getConfig` throws HTTP 404 (`details.provider`) for an unknown name. Caches nothing.                     |
| `parseIdpMetadata`                                                                                                       | function       | `(xml: string) => IdpMetadata`                                                                                                                                                                                                                                                                            | Throws HTTP 400 with `details.metadata` (or `details.certificate`) on refusal. See Gotchas.               |
| `IdpMetadata`                                                                                                            | type           | `{ entityId, ssoUrl: URL, ssoPostUrl?: URL, signingCertificates: SamlCertificate[], nameIdFormats: string[], validUntil?: DateTime }`                                                                                                                                                                     | `signingCertificates` is never empty.                                                                     |
| `generateSpMetadata`                                                                                                     | function       | `(config: SamlProviderConfig) => string`                                                                                                                                                                                                                                                                  | SP `EntityDescriptor` XML: POST ACS, `WantAssertionsSigned="true"`, NameID format, encryption key if set. |
| `parseSamlCertificate`                                                                                                   | function       | `(text: string) => SamlCertificate`                                                                                                                                                                                                                                                                       | PEM or bare base64 (whitespace ignored). HTTP 400 with `details.certificate` when not X.509.              |
| `SamlCertificate`                                                                                                        | type           | `{ pem, base64, subject, notBefore: DateTime, notAfter: DateTime, fingerprint256 }`                                                                                                                                                                                                                       | Validity in UTC.                                                                                          |
| `SAML_METADATA_NS`, `XMLDSIG_NS`, `SAML_PROTOCOL`, `SAML_REDIRECT_BINDING`, `SAML_POST_BINDING`                          | constants      | URNs                                                                                                                                                                                                                                                                                                      | —                                                                                                         |
| `SamlFactorService`                                                                                                      | class          | `beginAuthorization({ provider, intent, actorId?, redirectAfter?, forceAuthn? })`, `completeAuthorization({ params })`, `createFactorFromAuthorization`, `hasPendingAuthorization`, `stashAuthenticatedExchange`, `redeemAuthenticatedExchange`, `getFactor`, `listFactors`, `findFactor`, `deleteFactor` | Same flow and results as `OidcFactorService`. See Gotchas for every check.                                |
| `SamlFactorServiceOptions`                                                                                               | class          | `new (requestExpiration?, clockSkew?, pendingAuthorizationExpiration?, authenticatedExchangeExpiration?)`                                                                                                                                                                                                 | Defaults: 10 min, 60 s, 30 min, 2 min (Luxon `Duration`s).                                                |
| `SamlProfile`                                                                                                            | type           | `{ provider, subject, nameIdFormat?, email?, name?, authnContextClassRef?, authnInstant?: DateTime, sessionIndex?, issuer, attributes }`                                                                                                                                                                  | `subject` is the NameID.                                                                                  |
| `SamlAuthorizationResult`, `SamlAuthorizationIntent`, `SamlCallbackParams`, `SamlAuthenticatedExchange`                  | types          | `signed-in` / `linked` / `new-user` / `stepped-up`; `'sign-in' \| 'link' \| 'step-up'`; `{ SAMLResponse?, RelayState? }`; `{ actorId, factorId, isNewUser? }`                                                                                                                                             | As the OIDC equivalents.                                                                                  |
| `SamlFactorRepository`                                                                                                   | abstract class | `FactorRepository<SamlFactor, SamlFactorValue, SamlFactorLookup>` plus `findFactor`, `updateEmail`                                                                                                                                                                                                        | You implement it. Unique on `(provider, subject)`.                                                        |
| `SamlFactor`, `SamlFactorValue`, `SamlFactorLookup`                                                                      | types          | `{ provider, subject, email? }`                                                                                                                                                                                                                                                                           | —                                                                                                         |
| `SamlActorEmailLookup`                                                                                                   | abstract class | `findActorByEmail(email): Promise<string \| undefined>`                                                                                                                                                                                                                                                   | Same shape as `OidcActorEmailLookup`; one class can serve both tokens.                                    |
| `SamlProfileAllowedPolicy`, `SAML_PROFILE_ALLOWED_POLICY`, `SamlPolicyMappings`, `SamlPolicyNames`, `SamlPolicyContexts` | policy         | `'auth.factor.saml.profile.allowed'`, context `{ profile }`                                                                                                                                                                                                                                               | Allows all by default. Spread `SamlPolicyMappings` next to `AuthenticationPolicyMappings`.                |
| `SamlProfileAttributeNames`                                                                                              | type           | `{ email?, name? }`                                                                                                                                                                                                                                                                                       | `SamlProviderConfig.attributeNames`; tried before the built-in names.                                     |

## Canonical usage

```typescript
import { Injectable } from 'injectkit';
import { SamlProviderRegistry, SamlProviderSource, generateSpMetadata, parseIdpMetadata, type SamlProviderConfig } from '@maroonedsoftware/saml';

@Injectable()
class OrgSamlProviderSource extends SamlProviderSource {
  constructor(private readonly connections: SamlConnectionRepository) {
    super();
  }

  async list(): Promise<SamlProviderConfig[]> {
    return (await this.connections.listEnabled()).map(row => ({
      name: row.slug,
      spEntityId: `https://app.example.com/saml/${row.slug}`,
      acsUrl: new URL(`https://app.example.com/saml/${row.slug}/acs`),
      idpEntityId: row.idpEntityId,
      idpSsoUrl: new URL(row.idpSsoUrl),
      idpSigningCertificates: row.idpCertificates,
    }));
  }
}

// setup hook
registry.register(SamlProviderSource).useClass(OrgSamlProviderSource).asSingleton();
registry.register(SamlProviderRegistry).useClass(SamlProviderRegistry).asSingleton();

// importing an admin's metadata
const metadata = parseIdpMetadata(xml);
await connections.save({
  idpEntityId: metadata.entityId,
  idpSsoUrl: metadata.ssoUrl.href,
  idpCertificates: metadata.signingCertificates.map(certificate => certificate.pem),
});

// serving the SP metadata
const spMetadata = generateSpMetadata(await samlProviders.getConfig(slug));

// sign-in: begin, then the ACS route (HTTP-POST form body)
registry.register(SamlFactorRepository).useClass(KyselySamlFactorRepository).asSingleton();
registry.register(SamlActorEmailLookup).useClass(EmailFactorActorLookup).asSingleton();
registry.register(SamlFactorServiceOptions).useValue(new SamlFactorServiceOptions());
registry.register(SamlFactorService).useClass(SamlFactorService).asSingleton();

const { url } = await saml.beginAuthorization({ provider: slug, intent: 'sign-in' }); // 302 to url
const result = await saml.completeAuthorization({ params: formBody });
if (result.kind === 'new-user') {
  await saml.createFactorFromAuthorization(await createActor(result.profile), result.authorizationId);
}
```

## Caller responsibilities

`SamlFactorService` holds no browser state, so it cannot tell which browser started a flow. Three
checks belong to the app:

- **Bind the request to the browser.** `completeAuthorization` trusts whichever stored AuthnRequest
  the response's `InResponseTo` names, and ignores `RelayState`. Store the `requestId` that
  `beginAuthorization` returns in a cookie or session for that browser, and refuse an ACS post whose
  request that browser did not start (compare it with the `InResponseTo` on the decoded
  `SAMLResponse` before calling `completeAuthorization`; the service still checks the signed copy).
  Without this, an attacker can begin a `link` for their own account and send the IdP URL to a
  victim: the victim's identity is linked to the attacker's account. The same gap allows login CSRF
  on `sign-in`.
- **Match the actor.** On `stepped-up` and `linked` results, check that `result.actorId` is the
  actor of the current session before acting on it.
- **Allow-list `redirectAfter`.** It is returned exactly as `beginAuthorization` received it and is
  not validated. Redirecting to it unchecked is an open redirect.

## Rules for generated code

- Store `idpSigningCertificates` from `parseIdpMetadata`'s `signingCertificates[].pem`; never take a
  certificate from a SAML message.
- Keep the old and new certificates both listed while an IdP rotates, then drop the old one.
- Give each provider its own `spEntityId` and `acsUrl` when one app serves many organizations, so an
  assertion for one connection cannot satisfy another's audience check.
- Treat `name` as permanent: it identifies the factors created through the provider.
- Let the HTTP 400 from `parseIdpMetadata` reach the client: `details.metadata` is written for the
  admin who uploaded the document.
- Pass the ACS form body to `completeAuthorization` untouched; do not pre-validate `SAMLResponse`,
  and never read the profile from it yourself. Reading its `InResponseTo` to match the browser's
  stored `requestId` is the one exception (see Caller responsibilities).
- Set `trustEmail` only to vouch for addresses the IdP is authoritative for (a domain the
  connection's organization verified). Without it nothing auto-links.
- Refuse addresses outside a connection's domains in an `auth.factor.saml.profile.allowed` policy,
  not after `completeAuthorization` returns: the policy runs before any factor is touched.

## Gotchas

- **The metadata signature is not verified.** `parseIdpMetadata` trusts the document it is given,
  so only accept metadata from an authenticated admin, not from a URL a third party controls.
- **Expired certificates are not refused.** They come back with their `notAfter`; check it if you
  want to warn or refuse.
- **Only the IDPSSODescriptor's certificates count.** Entra's WS-Fed `RoleDescriptor` and the
  document's own `Signature` carry certificates too, and both are ignored.
- **A `KeyDescriptor` without `use` is a signing key**, per the metadata spec. `use="encryption"`
  keys are skipped.
- **An HTTP-Redirect SSO endpoint is required.** Metadata that only offers HTTP-POST is refused,
  since AuthnRequests are sent by redirect.
- **`generateSpMetadata` output is not deterministic**: node-saml stamps a fresh `ID` on each call.
  Compare parsed fields, not strings.
- **`spDecryption.certificate` is validated** when the SP metadata is generated; a bad one is an
  HTTP 400 even though it is server configuration.

- **Only SP-initiated sign-in.** A response without `InResponseTo`, or answering a request this
  service did not issue or already saw answered, is refused (400 / 404, audit reason `unsolicited`).
  The request is consumed before validation, so a refused response cannot be retried.
- **What `completeAuthorization` checks**, none optional: SHA-1 anywhere in the signatures
  (`weak signature algorithm`); `Destination` equals `acsUrl` and is required; response and
  assertion `Issuer` equal `idpEntityId`; node-saml then checks `InResponseTo` (its own store, on
  the same cache), the assertion signature against `idpSigningCertificates` only (the response
  signature is optional), a single assertion, `Audience`, and `NotBefore` / `NotOnOrAfter` with
  `clockSkew`; then a bearer `SubjectConfirmationData` whose `Recipient` equals `acsUrl`, whose
  `InResponseTo` is the request id (`does not answer the request`, audit reason `unsolicited`:
  the response's own `InResponseTo` is unsigned and node-saml accepts a confirmation without one),
  and whose `NotOnOrAfter` is present and holds within `clockSkew`, an assertion `ID`, a NameID, an accepted `AuthnContextClassRef`, a fresh
  `AuthnInstant` when `ForceAuthn` was sent, and finally the replay store (`cache.add` on the
  issuer and assertion `ID`, kept until the later `NotOnOrAfter` plus skew).
- **401 `details.assertion` values**: `weak signature algorithm`, `destination mismatch`,
  `issuer mismatch`, `signature invalid`, `audience mismatch`, `outside validity window`,
  `recipient mismatch`, `does not answer the request`, `authentication context not accepted`, `authentication not fresh`,
  `already used`, and a few `missing …` ones. node-saml's own message is in `internalDetails.reason`.
- **SHA-1 inside an `EncryptedAssertion` is not caught**: the algorithm check runs on the
  received document before decryption.
- **No `email_verified` in SAML.** Without `trustEmail`, a new NameID whose email matches an account
  answers `new-user` with `emailConflict`, never `linked`.
- **The cache must implement `add` atomically** (only-if-absent). The replay store relies on it.
- **node-saml reads the wall clock** (`Date`), so tests sign fixtures with timestamps relative to
  now rather than faking time.

## Working inside this package

- `src/saml.provider.ts` (config, source, registry), `src/saml.certificate.ts`,
  `src/idp.metadata.parser.ts`, `src/sp.metadata.generator.ts`, `src/saml.factor.service.ts`,
  `src/saml.factor.repository.ts`, `src/saml.profile.allowed.policy.ts`, and the internal
  `src/saml.response.reader.ts` (DOM reads of the raw response and the verified assertion); barrel
  `src/index.ts`.
- Tests in `tests/`, fixtures in `tests/fixtures/`: Okta-, Entra- and Google-shaped IdP metadata
  with self-signed certificates generated by `openssl req -x509` with fixed validity dates. The
  certificates are `.crt` because the repo ignores `*.pem`. The `idp.current`, `idp.next` and
  `attacker` `.signing.key` / `.signing.crt` pairs exist only to sign responses in the tests:
  `tests/saml.response.builder.ts` builds a response from options and signs it with `xml-crypto`
  (a dev dependency).
- The parser walks the DOM by namespace and local name; prefixes vary by IdP (`md:` for Okta and
  Google, the default namespace for Entra), so never match on a prefixed tag name.
- Every user-visible change needs a changeset. A new export goes in the barrel, this table and the
  README.
