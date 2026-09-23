import { describe, expect, it } from 'vitest';
import { authorizationServerMetadataUrl, buildAuthorizationServerMetadata, wellKnownUrl } from '../../src/oauth/authorization.server.metadata.js';

const base = {
  issuer: 'https://station.example.com',
  authorizationEndpoint: 'https://station.example.com/oauth/authorize',
  tokenEndpoint: 'https://station.example.com/api/auth/oauth/token',
  scopesSupported: ['mcp'],
  clientIdMetadataDocumentSupported: true,
};

describe('buildAuthorizationServerMetadata', () => {
  it('advertises dynamic registration only when a registration endpoint is given', () => {
    expect(buildAuthorizationServerMetadata({ ...base, registrationEndpoint: 'https://station.example.com/api/auth/oauth/register' })).toEqual({
      issuer: 'https://station.example.com',
      authorization_endpoint: 'https://station.example.com/oauth/authorize',
      token_endpoint: 'https://station.example.com/api/auth/oauth/token',
      registration_endpoint: 'https://station.example.com/api/auth/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['mcp'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      resource_indicators_supported: true,
    });
  });

  it('omits the registration endpoint when dynamic registration is off', () => {
    const metadata = buildAuthorizationServerMetadata(base);

    expect('registration_endpoint' in metadata).toBe(false);
    // Claude chooses CIMD only when both of these are advertised.
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.token_endpoint_auth_methods_supported).toContain('none');
  });

  it('can decline to advertise client id metadata documents', () => {
    expect(buildAuthorizationServerMetadata({ ...base, clientIdMetadataDocumentSupported: false }).client_id_metadata_document_supported).toBe(false);
  });

  it('copies the scopes rather than aliasing the input', () => {
    const scopes = ['mcp'];
    const metadata = buildAuthorizationServerMetadata({ ...base, scopesSupported: scopes });
    scopes.push('later');

    expect(metadata.scopes_supported).toEqual(['mcp']);
  });
});

describe('well-known URLs', () => {
  it('puts the suffix at the origin for an issuer with no path', () => {
    expect(authorizationServerMetadataUrl('https://station.example.com')).toBe('https://station.example.com/.well-known/oauth-authorization-server');
    expect(authorizationServerMetadataUrl('https://station.example.com/')).toBe('https://station.example.com/.well-known/oauth-authorization-server');
  });

  it('appends an issuer path after the suffix', () => {
    expect(authorizationServerMetadataUrl('https://example.com/tenant/1')).toBe(
      'https://example.com/.well-known/oauth-authorization-server/tenant/1',
    );
  });

  it('keeps a port', () => {
    expect(wellKnownUrl('http://localhost:3000/api/mcp', 'oauth-protected-resource')).toBe(
      'http://localhost:3000/.well-known/oauth-protected-resource/api/mcp',
    );
  });
});
