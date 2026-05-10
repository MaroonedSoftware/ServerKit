import type { ScimSchema } from './schema.types.js';

/** Schema URI for the SCIM EnterpriseUser extension. */
export const EnterpriseUserSchemaId = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

/**
 * RFC 7643 §4.3: EnterpriseUser extension schema definition.
 */
export const enterpriseUserSchema: ScimSchema = {
  id: EnterpriseUserSchemaId,
  name: 'EnterpriseUser',
  description: 'Enterprise User extension',
  meta: { resourceType: 'Schema', location: `/Schemas/${EnterpriseUserSchemaId}` },
  attributes: [
    { name: 'employeeNumber', type: 'string', multiValued: false, description: 'Employee number.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'costCenter', type: 'string', multiValued: false, description: 'Cost center.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'organization', type: 'string', multiValued: false, description: 'Organization name.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'division', type: 'string', multiValued: false, description: 'Division name.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'department', type: 'string', multiValued: false, description: 'Department name.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    {
      name: 'manager',
      type: 'complex',
      multiValued: false,
      description: 'The manager of the user.',
      required: false,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'none',
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, description: 'Manager user id.', required: false, caseExact: true, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
        { name: '$ref', type: 'reference', multiValued: false, description: 'URI of the manager User resource.', required: false, caseExact: true, mutability: 'readWrite', returned: 'default', uniqueness: 'none', referenceTypes: ['User'] },
        { name: 'displayName', type: 'string', multiValued: false, description: 'Manager display name.', required: false, caseExact: false, mutability: 'readOnly', returned: 'default', uniqueness: 'none' },
      ],
    },
  ],
};
