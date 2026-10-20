import { DOMParser } from '@xmldom/xmldom';
import { DateTime } from 'luxon';
import { XMLDSIG_NS } from './idp.metadata.parser.js';

/** The SAML 2.0 assertion namespace. */
export const SAML_ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
/** The SAML 2.0 protocol namespace (`samlp:`). */
export const SAML_PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
/** The bearer subject confirmation method, the only one the Web Browser SSO profile uses. */
export const SAML_BEARER_METHOD = 'urn:oasis:names:tc:SAML:2.0:cm:bearer';

/** What is read from a `samlp:Response` before its signatures are checked. None of it is trusted yet. */
export type UnverifiedSamlResponse = {
  /** The decoded XML, as received. */
  xml: string;
  /** The response's `InResponseTo`: the AuthnRequest id it claims to answer. */
  inResponseTo?: string;
  /** The response's `Destination`. */
  destination?: string;
  /** The response-level `Issuer`, when present. */
  issuer?: string;
  /** Every `SignatureMethod` and `DigestMethod` algorithm in the document, encrypted parts excepted. */
  algorithms: string[];
};

/** What is read from an assertion after node-saml has verified its signature. */
export type VerifiedSamlAssertion = {
  /** The assertion's `ID`, the replay key. */
  id?: string;
  /** The assertion's `Issuer`. */
  issuer?: string;
  /** `Conditions/@NotOnOrAfter`. */
  conditionsNotOnOrAfter?: DateTime;
  /** Bearer `SubjectConfirmationData` elements: where the assertion may be delivered, until when, and which request it answers. */
  bearerConfirmations: { recipient?: string; notOnOrAfter?: DateTime; inResponseTo?: string }[];
  /** `AuthnStatement/@AuthnInstant`. */
  authnInstant?: DateTime;
  /** `AuthnStatement/@SessionIndex`. */
  sessionIndex?: string;
  /** `AuthnStatement/AuthnContext/AuthnContextClassRef`. */
  authnContextClassRef?: string;
};

/**
 * Decode a base64 `SAMLResponse` and read the routing fields of its `samlp:Response`.
 *
 * @returns `undefined` when the value is not base64 XML whose root is a SAML 2.0 `Response`, or
 *   when it carries a document type declaration (refused against entity expansion).
 */
export function readSamlResponse(encoded: string): UnverifiedSamlResponse | undefined {
  const xml = Buffer.from(encoded, 'base64').toString('utf8');
  if (/<!DOCTYPE/i.test(xml)) {
    return undefined;
  }
  const root = parseRoot(xml);
  if (!root || root.namespaceURI !== SAML_PROTOCOL_NS || root.localName !== 'Response') {
    return undefined;
  }

  const algorithms = [
    ...Array.from(root.getElementsByTagNameNS(XMLDSIG_NS, 'SignatureMethod')),
    ...Array.from(root.getElementsByTagNameNS(XMLDSIG_NS, 'DigestMethod')),
  ].map(element => element.getAttribute('Algorithm') ?? '');

  return {
    xml,
    ...optional('inResponseTo', attribute(root, 'InResponseTo')),
    ...optional('destination', attribute(root, 'Destination')),
    ...optional('issuer', textOf(child(root, SAML_ASSERTION_NS, 'Issuer'))),
    algorithms,
  };
}

/** Read the fields node-saml does not check from a verified assertion's XML. */
export function readVerifiedAssertion(xml: string): VerifiedSamlAssertion {
  const assertion = parseRoot(xml);
  if (!assertion || assertion.namespaceURI !== SAML_ASSERTION_NS || assertion.localName !== 'Assertion') {
    return { bearerConfirmations: [] };
  }

  const subject = child(assertion, SAML_ASSERTION_NS, 'Subject');
  const bearerConfirmations = (subject ? children(subject, SAML_ASSERTION_NS, 'SubjectConfirmation') : [])
    .filter(confirmation => confirmation.getAttribute('Method') === SAML_BEARER_METHOD)
    .map(confirmation => {
      const data = child(confirmation, SAML_ASSERTION_NS, 'SubjectConfirmationData');
      return {
        ...optional('recipient', data ? attribute(data, 'Recipient') : undefined),
        ...optional('notOnOrAfter', data ? instant(attribute(data, 'NotOnOrAfter')) : undefined),
        ...optional('inResponseTo', data ? attribute(data, 'InResponseTo') : undefined),
      };
    });

  const conditions = child(assertion, SAML_ASSERTION_NS, 'Conditions');
  const authnStatement = child(assertion, SAML_ASSERTION_NS, 'AuthnStatement');
  const authnContext = authnStatement ? child(authnStatement, SAML_ASSERTION_NS, 'AuthnContext') : undefined;

  return {
    ...optional('id', attribute(assertion, 'ID')),
    ...optional('issuer', textOf(child(assertion, SAML_ASSERTION_NS, 'Issuer'))),
    ...optional('conditionsNotOnOrAfter', conditions ? instant(attribute(conditions, 'NotOnOrAfter')) : undefined),
    bearerConfirmations,
    ...optional('authnInstant', authnStatement ? instant(attribute(authnStatement, 'AuthnInstant')) : undefined),
    ...optional('sessionIndex', authnStatement ? attribute(authnStatement, 'SessionIndex') : undefined),
    ...optional('authnContextClassRef', textOf(authnContext ? child(authnContext, SAML_ASSERTION_NS, 'AuthnContextClassRef') : undefined)),
  };
}

/** `true` for a SHA-1 signature or digest algorithm URI (`…#rsa-sha1`, `…#sha1`, `…#hmac-sha1`). */
export function isSha1Algorithm(algorithm: string): boolean {
  return /[#-]sha1$/i.test(algorithm);
}

function parseRoot(xml: string): Element | undefined {
  let failed = false;
  const fail = () => {
    failed = true;
  };
  try {
    const root = new DOMParser({ errorHandler: { error: fail, fatalError: fail } }).parseFromString(xml, 'text/xml')?.documentElement;
    return failed || !root ? undefined : root;
  } catch {
    return undefined;
  }
}

function children(parent: Element, namespace: string, localName: string): Element[] {
  const found: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    const element = node as Element;
    if (node.nodeType === 1 && element.namespaceURI === namespace && element.localName === localName) {
      found.push(element);
    }
  }
  return found;
}

function child(parent: Element, namespace: string, localName: string): Element | undefined {
  return children(parent, namespace, localName)[0];
}

function attribute(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name)?.trim();
  return value ? value : undefined;
}

function textOf(element: Element | undefined): string | undefined {
  const value = element?.textContent?.trim();
  return value ? value : undefined;
}

function instant(value: string | undefined): DateTime | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  return parsed.isValid ? parsed : undefined;
}

/** `{ [key]: value }` when `value` is defined, `{}` otherwise, so optional fields stay absent. */
function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}
