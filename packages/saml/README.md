# @maroonedsoftware/saml

SAML 2.0 service-provider toolkit for ServerKit, on [`@node-saml/node-saml`](https://github.com/node-saml/node-saml).

It is its own package rather than part of `@maroonedsoftware/authentication` so the XML and
xml-crypto dependency tree stays out of apps that only need passwords and OIDC.

It covers which IdPs this SP trusts, reading an IdP's metadata document, producing the SP's own
metadata for the IdP admin, and SP-initiated sign-in as an authentication factor with the same
shape and results as `@maroonedsoftware/authentication`'s OIDC factor. It is framework-free: your
ACS route passes the posted form to the service.

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
- **`SamlFactorService`**: `beginAuthorization` (HTTP-Redirect AuthnRequest, `ForceAuthn` for
  step-up, `RequestedAuthnContext`) and `completeAuthorization` (HTTP-POST response, every check
  below), resolving `(provider, NameID)` to `signed-in`, `linked`, `new-user` or `stepped-up`, plus
  `createFactorFromAuthorization` and a one-time authenticated exchange.
- **`SamlProfile`**: subject (NameID), email, name, `authnContextClassRef`, `authnInstant`,
  `sessionIndex`, and every attribute.
- **`SamlFactorRepository`**, **`SamlActorEmailLookup`**: the abstract classes you implement, as
  for OIDC.
- **`SamlProfileAllowedPolicy`** (`auth.factor.saml.profile.allowed`): consulted on every
  validated assertion; allows everything by default.
- **`trustEmail`** on `SamlProviderConfig`: the only way an asserted address can auto-link to an
  existing account, since SAML has no `email_verified`.

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

### Sign in

Register the service and what it needs (the cache, a policy service with `SamlPolicyMappings`, and
optionally an `AuditSink`):

```ts
import { SamlActorEmailLookup, SamlFactorRepository, SamlFactorService, SamlFactorServiceOptions } from '@maroonedsoftware/saml';

registry.register(SamlFactorRepository).useClass(KyselySamlFactorRepository).asSingleton();
registry.register(SamlActorEmailLookup).useClass(EmailFactorActorLookup).asSingleton(); // same class as OidcActorEmailLookup
registry.register(SamlFactorServiceOptions).useValue(new SamlFactorServiceOptions());
registry.register(SamlFactorService).useClass(SamlFactorService).asSingleton();
```

Start the flow and redirect:

```ts
const { url, requestId } = await saml.beginAuthorization({ provider: 'acme', intent: 'sign-in', redirectAfter: '/jobs' });
// keep requestId for this browser (a SameSite=None; Secure cookie, or the session), then 302 to url
```

On the ACS route (HTTP-POST, `application/x-www-form-urlencoded`), pass the form through with the
`requestId` this browser started:

```ts
const result = await saml.completeAuthorization({ params: body, expectedRequestId: storedRequestId });

switch (result.kind) {
  case 'signed-in':
  case 'linked': {
    const exchangeId = await saml.stashAuthenticatedExchange({ actorId: result.actorId, factorId: result.factorId });
    // redirect to the SPA with exchangeId; it redeems it with redeemAuthenticatedExchange
    break;
  }
  case 'new-user':
    // sign-up (or just-in-time provisioning), then:
    await saml.createFactorFromAuthorization(newActorId, result.authorizationId);
    break;
}
```

Step up a signed-in user at their IdP with `intent: 'step-up'` and their `actorId`: the request
carries `ForceAuthn="true"`, the answer is `stepped-up`, and `profile.authnInstant` is checked to
fall within the round trip. Judge `profile.authnContextClassRef` to decide what the step-up grants.

To let an organization's IdP vouch for addresses in its verified domains:

```ts
{
  name: `org:${connection.id}`,
  // ...
  trustEmail: profile => verifiedDomains.has(profile.email?.split('@')[1]?.toLowerCase() ?? ''),
}
```

### What a response must pass

Nothing here can be turned off. A response is refused unless:

- it answers an AuthnRequest this service issued and has not seen answered (`InResponseTo`, held
  in the cache for `requestExpiration`, ten minutes by default), and the signed assertion's bearer
  `SubjectConfirmationData` carries the same `InResponseTo`. IdP-initiated responses are refused,
  including an IdP-initiated assertion rewrapped in a response to another request;
- its assertion is signed by one of the provider's `idpSigningCertificates` (never a certificate
  from the message), with no SHA-1 signature or digest, and is the only assertion;
- `Destination` and the bearer `SubjectConfirmationData/@Recipient` equal `acsUrl`, the assertion's
  `Issuer` (and the response's, if present) equals `idpEntityId`, and the `Audience` equals `spEntityId`;
- `NotBefore` / `NotOnOrAfter` hold, on the conditions and on that bearer confirmation, within
  `clockSkew` (60 seconds by default);
- its `AuthnContextClassRef` is one of `acceptedAuthnContexts`, when the provider lists any;
- its assertion `ID` has not been accepted before. Accepted ids are kept until the assertion expires.

Refusals are HTTP errors: 400 for a missing, malformed or unsolicited response and for an IdP error
status, 401 with `details.assertion` naming the failed check, 403 for a policy denial, 404 for an
unknown or already-answered `InResponseTo`. Each one records a `saml.authorization.failed` audit
event with its reason.

### Caller responsibilities

`SamlFactorService` holds no browser state, so it cannot tell which browser started a flow. The app
must enforce three things:

- **Bind each request to its browser.** `completeAuthorization` trusts whichever stored AuthnRequest
  the response's `InResponseTo` names, and ignores `RelayState`. Keep the `requestId` returned by
  `beginAuthorization` in a cookie or session for that browser, and pass it to
  `completeAuthorization` as `expectedRequestId`. A response to any other request is then refused
  with a 400 (`details.InResponseTo: 'not the expected request'`) and that request is left
  untouched. The ACS post arrives cross-site from the IdP, so a cookie needs `SameSite=None; Secure`.
  The argument is required: when the browser has no stored id (an expired cookie, another browser), refuse the post or restart the flow. Otherwise an attacker can begin a `link` for their own account and send the IdP URL to a victim,
  whose identity then gets linked to the attacker's account. The same flow allows login CSRF on
  `sign-in`.
- **Check the actor.** On `stepped-up` and `linked` results, confirm that `result.actorId` is the
  actor of the current session.
- **Allow-list `redirectAfter`.** It is returned as given and never validated, so redirecting to it
  unchecked is an open redirect.

### Choose a stable NameID

`subject` is the assertion's `NameID`, and a factor is keyed on `(provider, subject)`. The default
`emailAddress` format is only as stable as the mailbox: when an organization reassigns an address,
the new holder signs in to the old holder's account. Prefer the `persistent` format
(`urn:oasis:names:tc:SAML:2.0:nameid-format:persistent`) on `nameIdFormat` wherever the IdP offers it.

## Notes

- Certificates are only ever taken from the provider configuration. The metadata document's own
  signature is not verified, so import metadata from a source the admin trusts (an upload or a
  pasted document from their IdP console).
- Expired certificates are returned with their `notAfter` rather than refused; deciding whether to
  accept or warn is the app's call.
- Okta, Entra ID and Google Workspace metadata are covered by the tests, including Entra's WS-Fed
  `RoleDescriptor` (its certificate is ignored) and its two-certificate rotation.
- SHA-1 is refused only where the signature is visible: inside an encrypted assertion the
  algorithm is not inspected.
