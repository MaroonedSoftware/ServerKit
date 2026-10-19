# @maroonedsoftware/saml

SAML 2.0 service-provider toolkit for ServerKit, on [`@node-saml/node-saml`](https://github.com/node-saml/node-saml).

It is its own package rather than part of `@maroonedsoftware/authentication` so the XML and
xml-crypto dependency tree stays out of apps that only need passwords and OIDC.

This release covers configuration and metadata: which IdPs this SP trusts, reading an IdP's
metadata document, and producing the SP's own metadata for the IdP admin. The sign-in factor
(AuthnRequest, response validation) is not part of it yet.

## What's included

- **`SamlProviderConfig`**: one IdP connection: SP entity id, ACS URL, IdP entity id, IdP SSO URL,
  IdP signing certificates (a list, so rotations overlap), optional SP decryption key pair, accepted
  `AuthnContextClassRef`s, and the NameID format.
- **`SamlProviderSource`**: an abstract DI token the registry re-reads on every lookup, so
  connections stored in a database change without a restart. `SamlProviderRegistryConfig` is the
  static implementation.
- **`SamlProviderRegistry`**: `getConfig(name)` (404 when unknown) and `listProviders()`.
- **`parseIdpMetadata(xml)`**: entity id, HTTP-Redirect SSO URL, signing certificates with their
  validity period, NameID formats and `validUntil`. Refuses metadata without a signing certificate,
  without a redirect SSO endpoint, with a `DOCTYPE`, or with more than one IdP, as HTTP 400s.
- **`generateSpMetadata(config)`**: the SP's `EntityDescriptor` with the POST ACS,
  `WantAssertionsSigned="true"`, the NameID format, and the encryption certificate when configured.
- **`parseSamlCertificate(text)`**: PEM or bare base64 to PEM, subject, `notBefore` / `notAfter`
  (Luxon) and SHA-256 fingerprint.

## Install

```bash
pnpm add @maroonedsoftware/saml
```

## Usage

### Configure providers

```ts
import { SamlProviderRegistry, SamlProviderRegistryConfig, SamlProviderSource } from '@maroonedsoftware/saml';

registry.register(SamlProviderSource).useValue(
  new SamlProviderRegistryConfig([
    {
      name: 'acme',
      spEntityId: 'https://app.example.com/saml/acme',
      acsUrl: new URL('https://app.example.com/saml/acme/acs'),
      idpEntityId: 'http://www.okta.com/exk1a2b3c4d5e6f7g8h9',
      idpSsoUrl: new URL('https://acme.okta.com/app/example/exk1a2b3c4d5e6f7g8h9/sso/saml'),
      idpSigningCertificates: [oktaCertificatePem],
    },
  ]),
);
registry.register(SamlProviderRegistry).useClass(SamlProviderRegistry).asSingleton();
```

For per-organization connections, implement the source over your own table:

```ts
@Injectable()
class OrgSamlProviderSource extends SamlProviderSource {
  constructor(private readonly connections: SamlConnectionRepository) {
    super();
  }

  async list() {
    const rows = await this.connections.listEnabled();
    return rows.map(row => ({
      name: row.slug,
      spEntityId: `https://app.example.com/saml/${row.slug}`,
      acsUrl: new URL(`https://app.example.com/saml/${row.slug}/acs`),
      idpEntityId: row.idpEntityId,
      idpSsoUrl: new URL(row.idpSsoUrl),
      idpSigningCertificates: row.idpCertificates,
    }));
  }
}
```

### Import an IdP's metadata

```ts
import { DateTime } from 'luxon';
import { parseIdpMetadata } from '@maroonedsoftware/saml';

const metadata = parseIdpMetadata(uploadedXml); // HTTP 400 with details.metadata on bad input

await connections.save({
  idpEntityId: metadata.entityId,
  idpSsoUrl: metadata.ssoUrl.href,
  idpCertificates: metadata.signingCertificates.map(certificate => certificate.pem),
});

const firstExpiry = DateTime.min(...metadata.signingCertificates.map(certificate => certificate.notAfter));
```

### Publish the SP's metadata

```ts
import { generateSpMetadata } from '@maroonedsoftware/saml';

const xml = generateSpMetadata(await samlProviders.getConfig('acme'));
// serve as application/samlmetadata+xml
```

## Notes

- Certificates are only ever taken from the provider configuration. The metadata document's own
  signature is not verified, so import metadata from a source the admin trusts (an upload or a
  pasted document from their IdP console).
- Expired certificates are returned with their `notAfter` rather than refused; deciding whether to
  accept or warn is the app's call.
- Okta, Entra ID and Google Workspace metadata are covered by the tests, including Entra's WS-Fed
  `RoleDescriptor` (its certificate is ignored) and its two-certificate rotation.
