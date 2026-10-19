import { X509Certificate } from 'node:crypto';
import { DateTime } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';

/** An X.509 certificate as it appears in SAML metadata, with what an operator needs to manage rotation. */
export type SamlCertificate = {
  /** The certificate as PEM, with a header, footer, and 64-character lines. */
  pem: string;
  /** The bare base64 DER body, as it appears in `ds:X509Certificate`. */
  base64: string;
  /** Subject distinguished name, one `key=value` per line as Node formats it. */
  subject: string;
  /** Start of the validity period (UTC). */
  notBefore: DateTime;
  /** End of the validity period (UTC). Compare against now to warn before an IdP certificate expires. */
  notAfter: DateTime;
  /** SHA-256 fingerprint, colon-separated uppercase hex. */
  fingerprint256: string;
};

const PEM_HEADER = '-----BEGIN CERTIFICATE-----';
const PEM_FOOTER = '-----END CERTIFICATE-----';

/**
 * Parse a certificate given as PEM or as the bare base64 body of a `ds:X509Certificate`
 * (whitespace and line breaks are ignored).
 *
 * @throws HTTP 400 when the text is not a valid X.509 certificate.
 */
export function parseSamlCertificate(text: string): SamlCertificate {
  const base64 = text.replace(PEM_HEADER, '').replace(PEM_FOOTER, '').replace(/\s+/g, '');
  if (base64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw httpError(400).withDetails({ certificate: 'not a base64 X.509 certificate' });
  }

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(Buffer.from(base64, 'base64'));
  } catch (error) {
    throw httpError(400)
      .withDetails({ certificate: 'not a valid X.509 certificate' })
      .withCause(error as Error);
  }

  return {
    pem: `${PEM_HEADER}\n${base64.match(/.{1,64}/g)?.join('\n') ?? base64}\n${PEM_FOOTER}\n`,
    base64,
    subject: certificate.subject,
    notBefore: parseValidity(certificate.validFrom),
    notAfter: parseValidity(certificate.validTo),
    fingerprint256: certificate.fingerprint256,
  };
}

/** Node formats validity as OpenSSL does: `Sep  1 00:00:00 2029 GMT` (day padded with a space). */
function parseValidity(value: string): DateTime {
  const parsed = DateTime.fromFormat(value.replace(/\s+/g, ' ').replace(/ GMT$/, ''), 'LLL d HH:mm:ss yyyy', { zone: 'utc', locale: 'en-US' });
  if (!parsed.isValid) {
    throw httpError(400).withDetails({ certificate: 'unreadable validity period' }).withInternalDetails({ value });
  }
  return parsed;
}
