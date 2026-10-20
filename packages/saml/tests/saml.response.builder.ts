import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { SignedXml } from 'xml-crypto';
import { fixture } from './fixtures.js';

/** Keys of the test IdPs in `tests/fixtures`, generated with openssl for these tests only. */
export const IDP_CURRENT = { key: fixture('idp.current.signing.key'), cert: fixture('idp.current.signing.crt') };
export const IDP_NEXT = { key: fixture('idp.next.signing.key'), cert: fixture('idp.next.signing.crt') };
export const ATTACKER = { key: fixture('attacker.signing.key'), cert: fixture('attacker.signing.crt') };

export const IDP_ENTITY_ID = 'https://idp.example.test/metadata';
export const SP_ENTITY_ID = 'https://app.example.test/saml/acme';
export const ACS_URL = 'https://app.example.test/saml/acme/acs';

const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

/** Everything a test can vary about a response. Defaults describe a valid response to `inResponseTo`. */
export type ResponseOptions = {
  inResponseTo?: string;
  assertionId?: string;
  nameId?: string;
  nameIdFormat?: string;
  issuer?: string;
  responseIssuer?: string;
  audience?: string;
  destination?: string;
  recipient?: string;
  now?: DateTime;
  notBefore?: DateTime;
  notOnOrAfter?: DateTime;
  authnInstant?: DateTime;
  authnContextClassRef?: string;
  sessionIndex?: string;
  attributes?: Record<string, string | string[]>;
  /**
   * Bearer subject confirmations, replacing the default single one. Each `recipient` defaults to
   * {@link ACS_URL} and `notOnOrAfter` to the assertion's. `inResponseTo` defaults to the response's;
   * pass it as `undefined` to leave it out.
   */
  subjectConfirmations?: SubjectConfirmationOptions[];
  /** Key the assertion is signed with; `undefined` leaves it unsigned. Defaults to {@link IDP_CURRENT}. */
  signWith?: { key: string; cert: string } | undefined;
  /** Also sign the whole response with this key. */
  signResponseWith?: { key: string; cert: string };
  /** Sign with RSA-SHA1 and a SHA-1 digest. */
  sha1?: boolean;
  /** A non-success top-level status code: no assertion is included. */
  status?: string;
  /** Applied to the signed XML before encoding, to tamper with it. */
  mutate?: (xml: string) => string;
};

export type SubjectConfirmationOptions = { inResponseTo?: string | undefined; recipient?: string; notOnOrAfter?: DateTime };

/** A `samlp:Response` to `options.inResponseTo`, signed as asked, base64-encoded for the POST binding. */
export function buildResponse(options: ResponseOptions = {}): string {
  return Buffer.from(buildResponseXml(options), 'utf8').toString('base64');
}

export function buildResponseXml(options: ResponseOptions = {}): string {
  const now = options.now ?? DateTime.utc();
  const iso = (value: DateTime) => value.toUTC().toISO({ suppressMilliseconds: true }) ?? '';
  const responseId = `_${crypto.randomBytes(16).toString('hex')}`;
  const assertionId = options.assertionId ?? `_${crypto.randomBytes(16).toString('hex')}`;
  const issuer = options.issuer ?? IDP_ENTITY_ID;
  const notOnOrAfter = options.notOnOrAfter ?? now.plus({ minutes: 5 });
  const notBefore = options.notBefore ?? now.minus({ minutes: 1 });
  const inResponseTo = options.inResponseTo === undefined ? '' : ` InResponseTo="${options.inResponseTo}"`;
  const destination = options.destination ?? ACS_URL;
  const responseIssuer = options.responseIssuer ?? issuer;

  const confirmations = (options.subjectConfirmations ?? [{ recipient: options.recipient ?? ACS_URL }])
    .map(confirmation => {
      const answers = 'inResponseTo' in confirmation ? confirmation.inResponseTo : options.inResponseTo;
      return (
        `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
        `<saml:SubjectConfirmationData${answers === undefined ? '' : ` InResponseTo="${answers}"`} ` +
        `NotOnOrAfter="${iso(confirmation.notOnOrAfter ?? notOnOrAfter)}" Recipient="${confirmation.recipient ?? ACS_URL}"/>` +
        `</saml:SubjectConfirmation>`
      );
    })
    .join('');

  const attributes = Object.entries(options.attributes ?? { email: 'ada@acme.test', displayName: 'Ada Lovelace' })
    .map(([name, value]) => {
      const values = (Array.isArray(value) ? value : [value]).map(entry => `<saml:AttributeValue>${entry}</saml:AttributeValue>`).join('');
      return `<saml:Attribute Name="${name}">${values}</saml:Attribute>`;
    })
    .join('');

  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${iso(now)}">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="${options.nameIdFormat ?? 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'}">${options.nameId ?? '00u1ada'}</saml:NameID>` +
    confirmations +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(notBefore)}" NotOnOrAfter="${iso(notOnOrAfter)}">` +
    `<saml:AudienceRestriction><saml:Audience>${options.audience ?? SP_ENTITY_ID}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(options.authnInstant ?? now)}" SessionIndex="${options.sessionIndex ?? '_session1'}">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>${
      options.authnContextClassRef ?? 'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport'
    }</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>` +
    `</saml:Assertion>`;

  const signWith = 'signWith' in options ? options.signWith : IDP_CURRENT;
  const status = options.status ?? 'urn:oasis:names:tc:SAML:2.0:status:Success';
  let xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${iso(now)}" Destination="${destination}"${inResponseTo}>` +
    `<saml:Issuer>${responseIssuer}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="${status}"/></samlp:Status>` +
    (options.status ? '' : assertion) +
    `</samlp:Response>`;

  if (signWith && !options.status) {
    xml = sign(xml, "//*[local-name(.)='Assertion']", signWith, options.sha1 === true);
  }
  if (options.signResponseWith) {
    xml = sign(xml, "/*[local-name(.)='Response']", options.signResponseWith, options.sha1 === true);
  }
  return options.mutate ? options.mutate(xml) : xml;
}

/** Sign the element at `xpath` with an enveloped signature placed after its `Issuer`, as IdPs do. */
function sign(xml: string, xpath: string, key: { key: string; cert: string }, sha1: boolean): string {
  const signer = new SignedXml({
    privateKey: key.key,
    publicCert: key.cert,
    signatureAlgorithm: sha1 ? RSA_SHA1 : RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
  });
  signer.addReference({ xpath, transforms: [ENVELOPED, EXC_C14N], digestAlgorithm: sha1 ? SHA1 : SHA256 });
  signer.computeSignature(xml, { location: { reference: `${xpath}/*[local-name(.)='Issuer']`, action: 'after' } });
  return signer.getSignedXml();
}
