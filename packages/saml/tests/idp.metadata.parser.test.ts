import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { HttpError } from '@maroonedsoftware/errors';
import { parseIdpMetadata } from '../src/idp.metadata.parser.js';
import { parseSamlCertificate } from '../src/saml.certificate.js';
import { fixture, thrown } from './fixtures.js';

const fingerprint = (name: string) => parseSamlCertificate(fixture(name)).fingerprint256;
const certBody = (name: string) => parseSamlCertificate(fixture(name)).base64;

/** The reason a refused document carries in `details.metadata`. */
function refusal(xml: string): unknown {
  const error = thrown(() => parseIdpMetadata(xml));
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).statusCode).toBe(400);
  return (error as HttpError).details?.metadata;
}

const MD = 'xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"';
const DS = 'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"';
const REDIRECT = '<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.test/sso"/>';
const keyDescriptor = (cert: string, use?: string) =>
  `<md:KeyDescriptor${use ? ` use="${use}"` : ''}><ds:KeyInfo ${DS}><ds:X509Data><ds:X509Certificate>${cert}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`;
const idp = (inner: string, protocol = 'urn:oasis:names:tc:SAML:2.0:protocol') =>
  `<md:IDPSSODescriptor protocolSupportEnumeration="${protocol}">${inner}</md:IDPSSODescriptor>`;
const entity = (inner: string, entityId = 'https://idp.example.test/entity') =>
  `<md:EntityDescriptor ${MD} entityID="${entityId}">${inner}</md:EntityDescriptor>`;

describe('parseIdpMetadata', () => {
  describe('Okta-shaped metadata', () => {
    const metadata = parseIdpMetadata(fixture('okta.idp.metadata.xml'));

    it('reads the entity id and both SSO bindings', () => {
      expect(metadata.entityId).toBe('http://www.okta.com/exk1a2b3c4d5e6f7g8h9');
      expect(metadata.ssoUrl.href).toBe('https://dev-12345678.okta.com/app/dev-12345678_ats_1/exk1a2b3c4d5e6f7g8h9/sso/saml');
      expect(metadata.ssoPostUrl?.href).toBe(metadata.ssoUrl.href);
    });

    it('reads the signing certificate with its expiry', () => {
      expect(metadata.signingCertificates).toHaveLength(1);
      expect(metadata.signingCertificates[0]?.fingerprint256).toBe(fingerprint('okta.cert.crt'));
      expect(metadata.signingCertificates[0]?.notAfter.toISO()).toBe('2035-03-01T00:00:00.000Z');
    });

    it('reads the NameID formats and has no validUntil', () => {
      expect(metadata.nameIdFormats).toEqual([
        'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
        'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      ]);
      expect(metadata.validUntil).toBeUndefined();
    });
  });

  describe('Entra-ID-shaped metadata', () => {
    const metadata = parseIdpMetadata(fixture('entra.idp.metadata.xml'));

    it('reads the entity id and the redirect SSO URL from a default-namespace document', () => {
      expect(metadata.entityId).toBe('https://sts.windows.net/9b2f6c1d-4e3a-4f5b-8c7d-1a2b3c4d5e6f/');
      expect(metadata.ssoUrl.href).toBe('https://login.microsoftonline.com/9b2f6c1d-4e3a-4f5b-8c7d-1a2b3c4d5e6f/saml2');
    });

    it('returns both rotation certificates in order, and none from the WS-Fed RoleDescriptor or the document signature', () => {
      expect(metadata.signingCertificates.map(certificate => certificate.fingerprint256)).toEqual([
        fingerprint('entra.current.cert.crt'),
        fingerprint('entra.next.cert.crt'),
      ]);
      expect(metadata.signingCertificates.map(certificate => certificate.notAfter.toISODate())).toEqual(['2028-01-15', '2029-09-01']);
    });
  });

  describe('Google-shaped metadata', () => {
    const metadata = parseIdpMetadata(fixture('google.idp.metadata.xml'));

    it('reads a line-wrapped certificate and validUntil', () => {
      expect(metadata.entityId).toBe('https://accounts.google.com/o/saml2?idpid=C01a2b3c4');
      expect(metadata.ssoUrl.href).toBe('https://accounts.google.com/o/saml2/idp?idpid=C01a2b3c4');
      expect(metadata.signingCertificates.map(certificate => certificate.fingerprint256)).toEqual([fingerprint('google.cert.crt')]);
      expect(metadata.validUntil?.equals(DateTime.fromISO('2030-06-01T00:00:00Z', { zone: 'utc' }))).toBe(true);
      expect(metadata.nameIdFormats).toEqual(['urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress']);
    });
  });

  it('treats a KeyDescriptor with no use as a signing key and skips encryption keys', () => {
    const metadata = parseIdpMetadata(
      entity(idp(keyDescriptor(certBody('okta.cert.crt'), 'encryption') + keyDescriptor(certBody('google.cert.crt')) + REDIRECT)),
    );
    expect(metadata.signingCertificates.map(certificate => certificate.fingerprint256)).toEqual([fingerprint('google.cert.crt')]);
  });

  it('deduplicates a certificate listed twice', () => {
    const cert = certBody('okta.cert.crt');
    const metadata = parseIdpMetadata(entity(idp(keyDescriptor(cert, 'signing') + keyDescriptor(cert) + REDIRECT)));
    expect(metadata.signingCertificates).toHaveLength(1);
  });

  it('returns an expired certificate with its expiry for the caller to judge', () => {
    const metadata = parseIdpMetadata(entity(idp(keyDescriptor(certBody('expired.cert.crt'), 'signing') + REDIRECT)));
    expect(metadata.signingCertificates[0]?.notAfter.toISODate()).toBe('2021-01-01');
  });

  it('picks the one IdP out of an EntitiesDescriptor that also holds an SP', () => {
    const sp = `<md:EntityDescriptor entityID="https://sp.example.test"><md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"/></md:EntityDescriptor>`;
    const xml = `<md:EntitiesDescriptor ${MD}>${sp}${entity(idp(keyDescriptor(certBody('okta.cert.crt'), 'signing') + REDIRECT))}</md:EntitiesDescriptor>`;
    expect(parseIdpMetadata(xml).entityId).toBe('https://idp.example.test/entity');
  });

  describe('refuses', () => {
    const signing = keyDescriptor(certBody('okta.cert.crt'), 'signing');

    it('metadata without a signing certificate', () => {
      expect(refusal(entity(idp(REDIRECT)))).toBe('no signing certificate');
      expect(refusal(entity(idp(keyDescriptor(certBody('okta.cert.crt'), 'encryption') + REDIRECT)))).toBe('no signing certificate');
    });

    it('the Okta fixture with its KeyDescriptor removed', () => {
      const xml = fixture('okta.idp.metadata.xml').replace(/<md:KeyDescriptor[\s\S]*<\/md:KeyDescriptor>/, '');
      expect(refusal(xml)).toBe('no signing certificate');
    });

    it('a signing certificate that is not X.509', () => {
      const error = thrown(() => parseIdpMetadata(entity(idp(keyDescriptor('aGVsbG8gd29ybGQ=', 'signing') + REDIRECT))));
      expect((error as HttpError).statusCode).toBe(400);
      expect((error as HttpError).details).toHaveProperty('certificate');
    });

    it('metadata without an HTTP-Redirect SingleSignOnService', () => {
      const post = '<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example.test/sso"/>';
      expect(refusal(entity(idp(signing + post)))).toBe('no HTTP-Redirect SingleSignOnService');
    });

    it('an SSO location that is not an http(s) URL', () => {
      const bad = REDIRECT.replace('https://idp.example.test/sso', 'javascript:alert(1)');
      expect(refusal(entity(idp(signing + bad)))).toBe('SingleSignOnService Location is not an http(s) URL');
    });

    it('a missing entityID', () => {
      expect(refusal(`<md:EntityDescriptor ${MD}>${idp(signing + REDIRECT)}</md:EntityDescriptor>`)).toBe('missing entityID');
    });

    it('SP metadata', () => {
      expect(refusal(entity('<md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"/>'))).toBe(
        'no SAML 2.0 IDPSSODescriptor',
      );
    });

    it('an IDPSSODescriptor for SAML 1.1 only', () => {
      expect(refusal(entity(idp(signing + REDIRECT, 'urn:oasis:names:tc:SAML:1.1:protocol')))).toBe('no SAML 2.0 IDPSSODescriptor');
    });

    it('more than one IdP', () => {
      const one = entity(idp(signing + REDIRECT), 'https://one.example.test');
      const two = entity(idp(signing + REDIRECT), 'https://two.example.test');
      expect(refusal(`<md:EntitiesDescriptor ${MD}>${one}${two}</md:EntitiesDescriptor>`)).toBe('more than one identity provider');
    });

    it('a document type declaration', () => {
      const xml = `<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY lol "lol">]>${entity(idp(signing + REDIRECT))}`;
      expect(refusal(xml)).toBe('document type declarations are not allowed');
    });

    it('XML that is not well-formed', () => {
      expect(refusal('<md:EntityDescriptor')).toBe('not well-formed XML');
      expect(refusal('')).toBe('not well-formed XML');
    });

    it('a document that is not SAML metadata', () => {
      expect(refusal('<EntityDescriptor entityID="x"/>')).toBe('not a SAML metadata document');
      expect(refusal('<html><body>Sign in</body></html>')).toBe('not a SAML metadata document');
    });
  });
});
