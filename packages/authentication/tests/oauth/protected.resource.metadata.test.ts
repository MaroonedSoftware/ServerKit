import { describe, expect, it } from 'vitest';
import { buildProtectedResourceMetadata, protectedResourceMetadataUrl } from '../../src/oauth/protected.resource.metadata.js';

describe('buildProtectedResourceMetadata', () => {
  it('names the resource, its authorization servers, and header-only bearer tokens', () => {
    expect(
      buildProtectedResourceMetadata({
        resource: 'https://station.example.com/api/mcp',
        authorizationServers: ['https://station.example.com'],
        scopesSupported: ['mcp'],
        resourceName: 'Station',
      }),
    ).toEqual({
      resource: 'https://station.example.com/api/mcp',
      authorization_servers: ['https://station.example.com'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
      resource_name: 'Station',
    });
  });

  it('leaves out the optional fields when not given', () => {
    expect(buildProtectedResourceMetadata({ resource: 'https://r.example/mcp', authorizationServers: ['https://r.example'] })).toEqual({
      resource: 'https://r.example/mcp',
      authorization_servers: ['https://r.example'],
      bearer_methods_supported: ['header'],
    });
  });
});

describe('protectedResourceMetadataUrl', () => {
  it('inserts the well-known segment between the origin and the resource path', () => {
    expect(protectedResourceMetadataUrl('https://station.example.com/api/mcp')).toBe(
      'https://station.example.com/.well-known/oauth-protected-resource/api/mcp',
    );
  });
});
