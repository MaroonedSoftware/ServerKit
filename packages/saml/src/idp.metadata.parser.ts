import { DOMParser } from '@xmldom/xmldom';
import { DateTime } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { parseSamlCertificate, type SamlCertificate } from './saml.certificate.js';

/** The SAML 2.0 metadata namespace. */
export const SAML_METADATA_NS = 'urn:oasis:names:tc:SAML:2.0:metadata';
/** The XML digital signature namespace. */
export const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
/** `protocolSupportEnumeration` value for SAML 2.0. */
export const SAML_PROTOCOL = 'urn:oasis:names:tc:SAML:2.0:protocol';
/** The HTTP-Redirect binding, used to send AuthnRequests. */
export const SAML_REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
/** The HTTP-POST binding, used to receive responses at the ACS. */
export const SAML_POST_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';

/** What an SP needs from an IdP's metadata document. */
export type IdpMetadata = {
  /** The IdP's `entityID`. Becomes {@link SamlProviderConfig.idpEntityId}. */
  entityId: string;
  /** The HTTP-Redirect SingleSignOnService location. Becomes {@link SamlProviderConfig.idpSsoUrl}. */
  ssoUrl: URL;
  /** The HTTP-POST SingleSignOnService location, when the IdP publishes one. Informational. */
  ssoPostUrl?: URL;
  /**
   * Signing certificates from the IdPSSODescriptor (`use="signing"` or no `use`), deduplicated
   * by fingerprint, in document order. Never empty. Their `pem` values become
   * {@link SamlProviderConfig.idpSigningCertificates}; `notAfter` tells you when to expect a rotation.
   */
  signingCertificates: SamlCertificate[];
  /** NameID formats the IdP says it supports, in document order. */
  nameIdFormats: string[];
  /** The document's `validUntil`, when present. Not enforced by the parser. */
  validUntil?: DateTime;
};

/**
 * Parse an IdP's SAML 2.0 metadata (an `EntityDescriptor`, or an `EntitiesDescriptor` holding
 * exactly one IdP) into the fields a {@link SamlProviderConfig} needs.
 *
 * Metadata is typically pasted or uploaded by an organization admin, so every refusal is an
 * HTTP 400 whose `details.metadata` says what is wrong. Refused:
 * - a document type declaration (`<!DOCTYPE`), which guards against entity expansion;
 * - XML that does not parse, or whose root is not SAML metadata;
 * - no SAML 2.0 `IDPSSODescriptor`, or more than one IdP in the document;
 * - a missing `entityID`;
 * - no HTTP-Redirect `SingleSignOnService`, or one whose location is not an http(s) URL;
 * - **no signing certificate**, or one that is not a valid X.509 certificate.
 *
 * Expired certificates are returned as-is with their `notAfter`; deciding what to do about one
 * is the caller's call. The metadata's own signature, if any, is not verified.
 */
export function parseIdpMetadata(xml: string): IdpMetadata {
  if (/<!DOCTYPE/i.test(xml)) {
    throw metadataError('document type declarations are not allowed');
  }

  const root = parseXml(xml);
  const entity = findIdpEntity(root);
  const idp = elementChildren(entity, 'IDPSSODescriptor').filter(isSaml2Descriptor);
  const descriptor = idp[0];
  if (!descriptor || idp.length > 1) {
    throw metadataError(idp.length > 1 ? 'more than one SAML 2.0 IDPSSODescriptor' : 'no SAML 2.0 IDPSSODescriptor');
  }

  const entityId = entity.getAttribute('entityID')?.trim();
  if (!entityId) {
    throw metadataError('missing entityID');
  }

  const ssoUrl = ssoLocation(descriptor, SAML_REDIRECT_BINDING);
  if (!ssoUrl) {
    throw metadataError('no HTTP-Redirect SingleSignOnService');
  }

  const signingCertificates = signingCertificatesOf(descriptor);
  if (signingCertificates.length === 0) {
    throw metadataError('no signing certificate');
  }

  const validUntilText = entity.getAttribute('validUntil') || root.getAttribute('validUntil');
  const validUntil = validUntilText ? DateTime.fromISO(validUntilText, { zone: 'utc' }) : undefined;

  return {
    entityId,
    ssoUrl,
    ssoPostUrl: ssoLocation(descriptor, SAML_POST_BINDING),
    signingCertificates,
    nameIdFormats: elementChildren(descriptor, 'NameIDFormat').map(element => textOf(element)),
    ...(validUntil?.isValid ? { validUntil } : {}),
  };
}

function metadataError(reason: string) {
  return httpError(400).withDetails({ metadata: reason });
}

function parseXml(xml: string): Element {
  const errors: string[] = [];
  const record = (message: string) => errors.push(message);
  let root: Element | undefined;
  try {
    root = new DOMParser({ errorHandler: { error: record, fatalError: record } }).parseFromString(xml, 'text/xml')?.documentElement ?? undefined;
  } catch (error) {
    record(String(error));
  }
  if (errors.length > 0 || !root) {
    throw metadataError('not well-formed XML').withInternalDetails({ errors });
  }
  if (root.namespaceURI !== SAML_METADATA_NS || (root.localName !== 'EntityDescriptor' && root.localName !== 'EntitiesDescriptor')) {
    throw metadataError('not a SAML metadata document');
  }
  return root;
}

/** The root itself, or the single IdP entity inside an `EntitiesDescriptor` (nested groups included). */
function findIdpEntity(root: Element): Element {
  if (root.localName === 'EntityDescriptor') {
    return root;
  }
  const entities = Array.from(root.getElementsByTagNameNS(SAML_METADATA_NS, 'EntityDescriptor')).filter(entity =>
    elementChildren(entity, 'IDPSSODescriptor').some(isSaml2Descriptor),
  );
  const entity = entities[0];
  if (!entity || entities.length > 1) {
    throw metadataError(entities.length > 1 ? 'more than one identity provider' : 'no SAML 2.0 IDPSSODescriptor');
  }
  return entity;
}

function isSaml2Descriptor(descriptor: Element): boolean {
  return (descriptor.getAttribute('protocolSupportEnumeration') ?? '').split(/\s+/).includes(SAML_PROTOCOL);
}

function ssoLocation(descriptor: Element, binding: string): URL | undefined {
  const service = elementChildren(descriptor, 'SingleSignOnService').find(element => element.getAttribute('Binding') === binding);
  if (!service) {
    return undefined;
  }
  const location = service.getAttribute('Location')?.trim() ?? '';
  const url = URL.canParse(location) ? new URL(location) : undefined;
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw metadataError('SingleSignOnService Location is not an http(s) URL');
  }
  return url;
}

/** Certificates of `KeyDescriptor`s marked `use="signing"` or with no `use` (which means both, per the spec). */
function signingCertificatesOf(descriptor: Element): SamlCertificate[] {
  const certificates = new Map<string, SamlCertificate>();
  for (const keyDescriptor of elementChildren(descriptor, 'KeyDescriptor')) {
    const use = keyDescriptor.getAttribute('use');
    if (use && use !== 'signing') {
      continue;
    }
    for (const element of Array.from(keyDescriptor.getElementsByTagNameNS(XMLDSIG_NS, 'X509Certificate'))) {
      const certificate = parseSamlCertificate(textOf(element));
      if (!certificates.has(certificate.fingerprint256)) {
        certificates.set(certificate.fingerprint256, certificate);
      }
    }
  }
  return [...certificates.values()];
}

/** Direct children of `parent` in the metadata namespace with the given local name. */
function elementChildren(parent: Element, localName: string): Element[] {
  const children: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    const element = node as Element;
    if (node.nodeType === 1 && element.namespaceURI === SAML_METADATA_NS && element.localName === localName) {
      children.push(element);
    }
  }
  return children;
}

function textOf(element: Element): string {
  return (element.textContent ?? '').trim();
}
