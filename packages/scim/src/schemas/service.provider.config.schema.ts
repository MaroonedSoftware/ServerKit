/** Schema URI for the SCIM ServiceProviderConfig resource. */
export const ServiceProviderConfigSchemaId = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';

/** Authentication scheme advertised by `/ServiceProviderConfig`. */
export interface ScimAuthenticationScheme {
  type: 'oauth' | 'oauth2' | 'oauthbearertoken' | 'httpbasic' | 'httpdigest';
  name: string;
  description: string;
  specUri?: string;
  documentationUri?: string;
  primary?: boolean;
}

/** Optional features the service provider supports (RFC 7643 §5). */
export interface ScimServiceProviderConfigOptions {
  documentationUri?: string;
  patch?: { supported: boolean };
  bulk?: { supported: boolean; maxOperations: number; maxPayloadSize: number };
  filter?: { supported: boolean; maxResults: number };
  changePassword?: { supported: boolean };
  sort?: { supported: boolean };
  etag?: { supported: boolean };
  authenticationSchemes?: ScimAuthenticationScheme[];
}

/** Materialised ServiceProviderConfig response. */
export interface ScimServiceProviderConfig extends Required<Omit<ScimServiceProviderConfigOptions, 'documentationUri' | 'authenticationSchemes'>> {
  schemas: [typeof ServiceProviderConfigSchemaId];
  documentationUri?: string;
  authenticationSchemes: ScimAuthenticationScheme[];
  meta: {
    resourceType: 'ServiceProviderConfig';
    location?: string;
  };
}

const defaultBearer: ScimAuthenticationScheme = {
  type: 'oauthbearertoken',
  name: 'OAuth Bearer Token',
  description: 'Authentication scheme using the OAuth Bearer Token Standard.',
  specUri: 'https://www.rfc-editor.org/info/rfc6750',
  primary: true,
};

/**
 * Build a SCIM ServiceProviderConfig response object, layering caller options
 * over the toolkit's defaults (PATCH on, filter on, sort on; bulk/changePassword/etag off).
 */
export const buildServiceProviderConfig = (options: ScimServiceProviderConfigOptions = {}): ScimServiceProviderConfig => ({
  schemas: [ServiceProviderConfigSchemaId],
  documentationUri: options.documentationUri,
  patch: options.patch ?? { supported: true },
  bulk: options.bulk ?? { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: options.filter ?? { supported: true, maxResults: 200 },
  changePassword: options.changePassword ?? { supported: false },
  sort: options.sort ?? { supported: true },
  etag: options.etag ?? { supported: false },
  authenticationSchemes: options.authenticationSchemes ?? [defaultBearer],
  meta: { resourceType: 'ServiceProviderConfig', location: '/ServiceProviderConfig' },
});
