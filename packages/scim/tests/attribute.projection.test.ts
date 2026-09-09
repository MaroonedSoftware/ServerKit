import { describe, expect, it } from 'vitest';
import { projectScimResource } from '../src/projection/attribute.projection.js';
import { userSchema } from '../src/schemas/user.schema.js';
import { enterpriseUserSchema, EnterpriseUserSchemaId } from '../src/schemas/enterprise.user.schema.js';
import { UserSchemaId } from '../src/schemas/user.schema.js';
import type { ScimAttributeDefinition } from '../src/schemas/schema.types.js';

const schemas = [userSchema, enterpriseUserSchema];

const makeUser = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'user-1',
  schemas: [UserSchemaId],
  userName: 'bjensen',
  displayName: 'Barbara Jensen',
  active: true,
  name: { givenName: 'Barbara', familyName: 'Jensen' },
  emails: [{ value: 'bjensen@example.com', type: 'work', primary: true }],
  meta: { resourceType: 'User', created: '2026-01-01T00:00:00.000Z', lastModified: '2026-01-01T00:00:00.000Z', location: '/Users/user-1' },
  ...overrides,
});

describe('projectScimResource', () => {
  describe('returned: never', () => {
    it('strips password with no projection requested', () => {
      const projected = projectScimResource(makeUser({ password: 'hunter2' }), schemas);
      expect(projected.password).toBeUndefined();
      expect(projected.userName).toBe('bjensen');
    });

    it('strips password even when it is explicitly requested', () => {
      const projected = projectScimResource(makeUser({ password: 'hunter2' }), schemas, { attributes: ['userName', 'password'] });
      expect(projected.password).toBeUndefined();
    });

    it('does not mutate the source resource', () => {
      const user = makeUser({ password: 'hunter2' });
      projectScimResource(user, schemas);
      expect(user.password).toBe('hunter2');
    });
  });

  describe('attributes', () => {
    it('returns only the requested attributes plus the always-returned core ones', () => {
      const projected = projectScimResource(makeUser(), schemas, { attributes: ['userName'] });
      expect(Object.keys(projected).sort()).toEqual(['id', 'meta', 'schemas', 'userName']);
    });

    it('keeps a parent attribute when a sub-attribute is requested, and narrows it', () => {
      const projected = projectScimResource(makeUser(), schemas, { attributes: ['name.givenName'] });
      expect(projected.name).toEqual({ givenName: 'Barbara' });
    });

    it('narrows sub-attributes inside a multi-valued complex attribute', () => {
      const projected = projectScimResource(makeUser(), schemas, { attributes: ['emails.value'] });
      expect(projected.emails).toEqual([{ value: 'bjensen@example.com' }]);
    });

    it('matches attribute names case-insensitively', () => {
      const projected = projectScimResource(makeUser(), schemas, { attributes: ['USERNAME'] });
      expect(projected.userName).toBe('bjensen');
    });

    it('resolves a fully-qualified extension path against the extension key', () => {
      const user = makeUser({ [EnterpriseUserSchemaId]: { employeeNumber: '4242', department: 'Tour Operations' } });
      const projected = projectScimResource(user, schemas, { attributes: [`${EnterpriseUserSchemaId}:employeeNumber`] });
      expect(projected[EnterpriseUserSchemaId]).toEqual({ employeeNumber: '4242' });
      expect(projected.userName).toBeUndefined();
    });

    it('wins over excludedAttributes when a client sends both', () => {
      const projected = projectScimResource(makeUser(), schemas, { attributes: ['userName'], excludedAttributes: ['userName'] });
      expect(projected.userName).toBe('bjensen');
    });
  });

  describe('excludedAttributes', () => {
    it('omits the named attribute and keeps the rest', () => {
      const projected = projectScimResource(makeUser(), schemas, { excludedAttributes: ['displayName'] });
      expect(projected.displayName).toBeUndefined();
      expect(projected.userName).toBe('bjensen');
    });

    it('omits a named sub-attribute without dropping its parent', () => {
      const projected = projectScimResource(makeUser(), schemas, { excludedAttributes: ['name.givenName'] });
      expect(projected.name).toEqual({ familyName: 'Jensen' });
    });

    it('never omits id, schemas, or meta', () => {
      const projected = projectScimResource(makeUser(), schemas, { excludedAttributes: ['id', 'schemas', 'meta'] });
      expect(projected.id).toBe('user-1');
      expect(projected.schemas).toEqual([UserSchemaId]);
      expect(projected.meta).toBeDefined();
    });
  });

  describe('returned: request', () => {
    const auditTrail: ScimAttributeDefinition = {
      name: 'auditTrail',
      type: 'string',
      multiValued: false,
      description: 'Only returned when asked for.',
      required: false,
      mutability: 'readOnly',
      returned: 'request',
      uniqueness: 'none',
    };
    const withRequestAttribute = [{ ...userSchema, attributes: [...userSchema.attributes, auditTrail] }, enterpriseUserSchema];

    it('omits the attribute when nothing was requested', () => {
      const projected = projectScimResource(makeUser({ auditTrail: 'trail' }), withRequestAttribute);
      expect(projected.auditTrail).toBeUndefined();
    });

    it('returns the attribute when it is named', () => {
      const projected = projectScimResource(makeUser({ auditTrail: 'trail' }), withRequestAttribute, { attributes: ['auditTrail'] });
      expect(projected.auditTrail).toBe('trail');
    });
  });

  it('keeps keys the schema does not define when no projection is requested', () => {
    const projected = projectScimResource(makeUser({ 'urn:example:custom': { tier: 'gold' } }), schemas);
    expect(projected['urn:example:custom']).toEqual({ tier: 'gold' });
  });
});
