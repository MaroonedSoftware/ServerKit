import { describe, expect, it } from 'vitest';
import { ScimServiceProviderService } from '../src/services/scim.service.provider.service.js';
import { ServiceProviderConfigSchemaId } from '../src/schemas/service.provider.config.schema.js';
import { UserSchemaId } from '../src/schemas/user.schema.js';
import { GroupSchemaId } from '../src/schemas/group.schema.js';

describe('ScimServiceProviderService', () => {
  it('returns a config with sensible defaults', () => {
    const service = new ScimServiceProviderService();
    const config = service.getServiceProviderConfig();
    expect(config.schemas).toEqual([ServiceProviderConfigSchemaId]);
    expect(config.patch.supported).toBe(true);
    expect(config.bulk.supported).toBe(false);
    expect(config.filter.supported).toBe(true);
    expect(config.filter.maxResults).toBe(200);
    expect(config.changePassword.supported).toBe(false);
    expect(config.sort.supported).toBe(true);
    expect(config.etag.supported).toBe(false);
    expect(config.authenticationSchemes).toHaveLength(1);
    expect(config.authenticationSchemes[0]?.type).toBe('oauthbearertoken');
  });

  it('overrides defaults with provided options', () => {
    const service = new ScimServiceProviderService({
      filter: { supported: true, maxResults: 50 },
      bulk: { supported: true, maxOperations: 100, maxPayloadSize: 1_000_000 },
      documentationUri: 'https://example.com/docs',
    });
    const config = service.getServiceProviderConfig();
    expect(config.filter.maxResults).toBe(50);
    expect(config.bulk.supported).toBe(true);
    expect(config.documentationUri).toBe('https://example.com/docs');
  });

  it('lists every core schema', () => {
    const service = new ScimServiceProviderService();
    const ids = service.listSchemas().map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining([UserSchemaId, GroupSchemaId]));
  });

  it('throws 404 for an unknown schema', () => {
    const service = new ScimServiceProviderService();
    try {
      service.getSchema('urn:bogus');
      expect.fail('expected throw');
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 404,
        details: { message: expect.stringMatching(/not found/) },
      });
    }
  });

  it('lists User and Group resource types', () => {
    const service = new ScimServiceProviderService();
    const types = service.listResourceTypes();
    expect(types.map(t => t.id)).toEqual(['User', 'Group']);
  });
});
