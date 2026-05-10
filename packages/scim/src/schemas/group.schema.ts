import type { ScimSchema } from './schema.types.js';

/** Schema URI for the SCIM core Group resource. */
export const GroupSchemaId = 'urn:ietf:params:scim:schemas:core:2.0:Group';

/**
 * RFC 7643 §4.2: SCIM core Group schema definition.
 */
export const groupSchema: ScimSchema = {
  id: GroupSchemaId,
  name: 'Group',
  description: 'Group',
  meta: { resourceType: 'Schema', location: `/Schemas/${GroupSchemaId}` },
  attributes: [
    {
      name: 'displayName',
      type: 'string',
      multiValued: false,
      description: 'Human-readable name for the Group.',
      required: true,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'none',
    },
    {
      name: 'members',
      type: 'complex',
      multiValued: true,
      description: 'List of Group members.',
      required: false,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'none',
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, description: 'Identifier of the member.', required: false, caseExact: true, mutability: 'immutable', returned: 'default', uniqueness: 'none' },
        { name: '$ref', type: 'reference', multiValued: false, description: 'URI of the member resource.', required: false, caseExact: true, mutability: 'immutable', returned: 'default', uniqueness: 'none', referenceTypes: ['User', 'Group'] },
        { name: 'display', type: 'string', multiValued: false, description: 'Human-readable name of the member.', required: false, caseExact: false, mutability: 'immutable', returned: 'default', uniqueness: 'none' },
        { name: 'type', type: 'string', multiValued: false, description: 'Member type.', required: false, caseExact: false, mutability: 'immutable', returned: 'default', uniqueness: 'none', canonicalValues: ['User', 'Group'] },
      ],
    },
  ],
};
