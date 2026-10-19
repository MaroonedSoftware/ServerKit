import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { HttpError } from '@maroonedsoftware/errors';
import { parseSamlCertificate } from '../src/saml.certificate.js';
import { fixture, present, thrown } from './fixtures.js';

const okta = fixture('okta.cert.crt');
const oktaBody = okta.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');

describe('parseSamlCertificate', () => {
  it('reads a PEM certificate with its validity period and fingerprint', () => {
    const certificate = parseSamlCertificate(okta);
    expect(certificate.notBefore.equals(DateTime.fromISO('2025-03-01T00:00:00Z', { zone: 'utc' }))).toBe(true);
    expect(certificate.notAfter.equals(DateTime.fromISO('2035-03-01T00:00:00Z', { zone: 'utc' }))).toBe(true);
    expect(certificate.subject).toContain('CN=dev-12345678');
    expect(certificate.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(certificate.base64).toBe(oktaBody);
  });

  it('reads a bare base64 body with line breaks and indentation, and rebuilds the PEM', () => {
    const wrapped = present(oktaBody.match(/.{1,40}/g)).join('\n      ');
    const certificate = parseSamlCertificate(`\n      ${wrapped}\n`);
    expect(certificate.base64).toBe(oktaBody);
    expect(certificate.pem).toMatch(/^-----BEGIN CERTIFICATE-----\n([A-Za-z0-9+/=]{64}\n)+[A-Za-z0-9+/=]{1,64}\n-----END CERTIFICATE-----\n$/);
    expect(parseSamlCertificate(certificate.pem).fingerprint256).toBe(parseSamlCertificate(okta).fingerprint256);
  });

  it('pads a single-digit day in the validity period', () => {
    const certificate = parseSamlCertificate(fixture('entra.next.cert.crt'));
    expect(certificate.notBefore.toISO()).toBe('2026-09-01T00:00:00.000Z');
  });

  it.each([
    ['empty text', ''],
    ['non-base64 text', 'not a certificate!'],
    ['base64 that is not DER', 'aGVsbG8gd29ybGQ='],
  ])('refuses %s with a 400', (_, text) => {
    const error = thrown(() => parseSamlCertificate(text));
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(400);
    expect((error as HttpError).details).toHaveProperty('certificate');
  });
});
