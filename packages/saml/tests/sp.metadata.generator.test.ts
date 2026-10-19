import { describe, it, expect } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { HttpError } from '@maroonedsoftware/errors';
import { generateSpMetadata } from '../src/sp.metadata.generator.js';
import { parseSamlCertificate } from '../src/saml.certificate.js';
import { SAML_METADATA_NS, XMLDSIG_NS } from '../src/idp.metadata.parser.js';
import type { SamlProviderConfig } from '../src/saml.provider.js';
import { fixture, present, thrown } from './fixtures.js';

// Metadata generation only publishes the certificate; the key is never read, so a placeholder will do.
const SP_PRIVATE_KEY = 'test-only placeholder, not a key';

const config: SamlProviderConfig = {
  name: 'acme',
  spEntityId: 'https://sp.example.test/saml/acme',
  acsUrl: new URL('https://sp.example.test/saml/acme/acs'),
  idpEntityId: 'http://www.okta.com/exk1a2b3c4d5e6f7g8h9',
  idpSsoUrl: new URL('https://dev-12345678.okta.com/app/sso/saml'),
  idpSigningCertificates: [fixture('okta.cert.crt')],
};

function spDescriptor(xml: string): { entity: Element; sp: Element } {
  const entity = present(new DOMParser().parseFromString(xml, 'text/xml').documentElement);
  const sp = present(entity.getElementsByTagNameNS(SAML_METADATA_NS, 'SPSSODescriptor')[0]);
  return { entity, sp };
}

describe('generateSpMetadata', () => {
  it('describes the SP entity, the POST ACS, signed assertions and the default NameID format', () => {
    const { entity, sp } = spDescriptor(generateSpMetadata(config));
    expect(entity.namespaceURI).toBe(SAML_METADATA_NS);
    expect(entity.localName).toBe('EntityDescriptor');
    expect(entity.getAttribute('entityID')).toBe('https://sp.example.test/saml/acme');
    expect(sp.getAttribute('protocolSupportEnumeration')).toBe('urn:oasis:names:tc:SAML:2.0:protocol');
    expect(sp.getAttribute('WantAssertionsSigned')).toBe('true');
    expect(sp.getAttribute('AuthnRequestsSigned')).toBe('false');

    const acs = present(sp.getElementsByTagNameNS(SAML_METADATA_NS, 'AssertionConsumerService')[0]);
    expect(acs.getAttribute('Binding')).toBe('urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST');
    expect(acs.getAttribute('Location')).toBe('https://sp.example.test/saml/acme/acs');

    expect(sp.getElementsByTagNameNS(SAML_METADATA_NS, 'NameIDFormat')[0]?.textContent).toBe(
      'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    );
    expect(sp.getElementsByTagNameNS(SAML_METADATA_NS, 'KeyDescriptor')).toHaveLength(0);
  });

  it('uses the provider NameID format', () => {
    const { sp } = spDescriptor(generateSpMetadata({ ...config, nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent' }));
    expect(sp.getElementsByTagNameNS(SAML_METADATA_NS, 'NameIDFormat')[0]?.textContent).toBe('urn:oasis:names:tc:SAML:2.0:nameid-format:persistent');
  });

  it('advertises the decryption certificate as an encryption key', () => {
    const certificate = fixture('sp.cert.crt');
    const { sp } = spDescriptor(generateSpMetadata({ ...config, spDecryption: { privateKey: SP_PRIVATE_KEY, certificate } }));
    const keys = sp.getElementsByTagNameNS(SAML_METADATA_NS, 'KeyDescriptor');
    expect(keys).toHaveLength(1);
    expect(keys[0]?.getAttribute('use')).toBe('encryption');
    expect(keys[0]?.getElementsByTagNameNS(XMLDSIG_NS, 'X509Certificate')[0]?.textContent?.replace(/\s+/g, '')).toBe(
      parseSamlCertificate(certificate).base64,
    );
  });

  it('refuses a decryption certificate that is not X.509', () => {
    const error = thrown(() => generateSpMetadata({ ...config, spDecryption: { privateKey: SP_PRIVATE_KEY, certificate: 'nope' } }));
    expect(error).toBeInstanceOf(HttpError);
  });
});
