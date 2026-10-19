import { generateServiceProviderMetadata } from '@node-saml/node-saml';
import { DEFAULT_SAML_NAME_ID_FORMAT, type SamlProviderConfig } from './saml.provider.js';
import { parseSamlCertificate } from './saml.certificate.js';

/**
 * This SP's metadata document for one provider, to hand to the IdP's admin (or serve at a
 * per-provider URL) when they set up the connection.
 *
 * It advertises `spEntityId`, the HTTP-POST ACS at `acsUrl`, the provider's NameID format,
 * `WantAssertionsSigned="true"` (the sign-in factor refuses unsigned assertions), and, when
 * {@link SamlProviderConfig.spDecryption} is set, its certificate as an `encryption`
 * KeyDescriptor. AuthnRequests are not signed, so no signing key is advertised.
 *
 * @throws HTTP 400 when `spDecryption.certificate` is not a valid X.509 certificate.
 */
export function generateSpMetadata(config: SamlProviderConfig): string {
  const decryption = config.spDecryption;
  return generateServiceProviderMetadata({
    issuer: config.spEntityId,
    callbackUrl: config.acsUrl.href,
    identifierFormat: config.nameIdFormat ?? DEFAULT_SAML_NAME_ID_FORMAT,
    wantAssertionsSigned: true,
    ...(decryption ? { decryptionPvk: decryption.privateKey, decryptionCert: parseSamlCertificate(decryption.certificate).pem } : {}),
  });
}
