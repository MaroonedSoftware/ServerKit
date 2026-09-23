import { wellKnownUrl } from './authorization.server.metadata.js';

/** The inputs to {@link buildProtectedResourceMetadata}. */
export interface ProtectedResourceMetadataInput {
  /** The resource identifier: the URL clients call, and the audience its tokens carry. */
  resource: string;
  /** Issuers of the authorization servers that grant tokens for it. */
  authorizationServers: readonly string[];
  scopesSupported?: readonly string[];
  /** A human-readable name for the resource. */
  resourceName?: string;
}

/** Protected resource metadata ([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)), in wire names. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: ['header'];
  scopes_supported?: string[];
  resource_name?: string;
}

/** Build the protected resource metadata document for one resource. Bearer tokens are accepted in the header only. */
export const buildProtectedResourceMetadata = (input: ProtectedResourceMetadataInput): ProtectedResourceMetadata => ({
  resource: input.resource,
  authorization_servers: [...input.authorizationServers],
  bearer_methods_supported: ['header'],
  ...(input.scopesSupported === undefined ? {} : { scopes_supported: [...input.scopesSupported] }),
  ...(input.resourceName === undefined ? {} : { resource_name: input.resourceName }),
});

/**
 * Where a resource's metadata lives, for the `resource_metadata` parameter of a
 * `WWW-Authenticate: Bearer` challenge: `https://host/api/mcp` becomes
 * `https://host/.well-known/oauth-protected-resource/api/mcp`.
 */
export const protectedResourceMetadataUrl = (resource: string): string => wellKnownUrl(resource, 'oauth-protected-resource');
