# AGENTS.md — @maroonedsoftware/saml

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

SAML 2.0 service-provider configuration and metadata on `@node-saml/node-saml`: a per-provider
config, a pluggable provider source and registry, IdP metadata parsing, and SP metadata generation.
It is separate from `authentication` to keep the XML dependency tree out of apps that do not need it.

There is no sign-in yet: no AuthnRequest, no response validation, no factor. Do not reach for this
package to authenticate users until that lands; for OIDC use `authentication`'s `OidcFactorService`.

## Install

```bash
pnpm add @maroonedsoftware/saml
```

No peers. Runtime dependencies: `@maroonedsoftware/errors`, `@node-saml/node-saml`,
`@xmldom/xmldom`, `injectkit`, `luxon`.

## Position in the graph

- **Depends on:** `errors`.
- **Depended on by:** nothing internal.
- **Subpath exports:** none.

## API surface

| Export                                                                                          | Kind           | Shape                                                                                                                                          | Notes                                                                                                     |
| ----------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `SamlProviderConfig`                                                                            | type           | `{ name, spEntityId, acsUrl: URL, idpEntityId, idpSsoUrl: URL, idpSigningCertificates, spDecryption?, acceptedAuthnContexts?, nameIdFormat? }` | `idpSigningCertificates` is PEM or bare base64, a list for rotation, never empty.                         |
| `SamlSpDecryption`                                                                              | type           | `{ privateKey: string; certificate: string }`                                                                                                  | The SP's encryption key pair; the certificate goes in the SP metadata.                                    |
| `DEFAULT_SAML_NAME_ID_FORMAT`                                                                   | constant       | `'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'`                                                                                     | Used when `nameIdFormat` is unset.                                                                        |
| `SamlProviderSource`                                                                            | abstract class | `list(): Promise<readonly SamlProviderConfig[]> \| readonly SamlProviderConfig[]`                                                              | DI token. Re-read on every lookup; first entry wins on a duplicate name.                                  |
| `SamlProviderRegistryConfig`                                                                    | class          | `new (providers?: SamlProviderConfig[])`                                                                                                       | Static source. Register with `.useValue(...)` under `SamlProviderSource`.                                 |
| `SamlProviderRegistry`                                                                          | class          | `getConfig(name): Promise<SamlProviderConfig>`, `listProviders(): Promise<string[]>`                                                           | `getConfig` throws HTTP 404 (`details.provider`) for an unknown name. Caches nothing.                     |
| `parseIdpMetadata`                                                                              | function       | `(xml: string) => IdpMetadata`                                                                                                                 | Throws HTTP 400 with `details.metadata` (or `details.certificate`) on refusal. See Gotchas.               |
| `IdpMetadata`                                                                                   | type           | `{ entityId, ssoUrl: URL, ssoPostUrl?: URL, signingCertificates: SamlCertificate[], nameIdFormats: string[], validUntil?: DateTime }`          | `signingCertificates` is never empty.                                                                     |
| `generateSpMetadata`                                                                            | function       | `(config: SamlProviderConfig) => string`                                                                                                       | SP `EntityDescriptor` XML: POST ACS, `WantAssertionsSigned="true"`, NameID format, encryption key if set. |
| `parseSamlCertificate`                                                                          | function       | `(text: string) => SamlCertificate`                                                                                                            | PEM or bare base64 (whitespace ignored). HTTP 400 with `details.certificate` when not X.509.              |
| `SamlCertificate`                                                                               | type           | `{ pem, base64, subject, notBefore: DateTime, notAfter: DateTime, fingerprint256 }`                                                            | Validity in UTC.                                                                                          |
| `SAML_METADATA_NS`, `XMLDSIG_NS`, `SAML_PROTOCOL`, `SAML_REDIRECT_BINDING`, `SAML_POST_BINDING` | constants      | URNs                                                                                                                                           | —                                                                                                         |

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
```

## Rules for generated code

- Store `idpSigningCertificates` from `parseIdpMetadata`'s `signingCertificates[].pem`; never take a
  certificate from a SAML message.
- Keep the old and new certificates both listed while an IdP rotates, then drop the old one.
- Give each provider its own `spEntityId` and `acsUrl` when one app serves many organizations, so an
  assertion for one connection cannot satisfy another's audience check.
- Treat `name` as permanent: it identifies the factors created through the provider.
- Let the HTTP 400 from `parseIdpMetadata` reach the client: `details.metadata` is written for the
  admin who uploaded the document.

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

## Working inside this package

- `src/saml.provider.ts` (config, source, registry), `src/saml.certificate.ts`,
  `src/idp.metadata.parser.ts`, `src/sp.metadata.generator.ts`; barrel `src/index.ts`.
- Tests in `tests/`, fixtures in `tests/fixtures/`: Okta-, Entra- and Google-shaped IdP metadata
  with self-signed certificates generated by `openssl req -x509` with fixed validity dates. The
  certificates are `.crt` because the repo ignores `*.pem`, and no private keys are kept.
- The parser walks the DOM by namespace and local name; prefixes vary by IdP (`md:` for Okta and
  Google, the default namespace for Entra), so never match on a prefixed tag name.
- Every user-visible change needs a changeset. A new export goes in the barrel, this table and the
  README.
