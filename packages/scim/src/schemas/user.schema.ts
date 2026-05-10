import type { ScimAttributeDefinition, ScimSchema } from './schema.types.js';

/** Schema URI for the SCIM core User resource. */
export const UserSchemaId = 'urn:ietf:params:scim:schemas:core:2.0:User';

/**
 * RFC 7643 §4.1: SCIM core User schema definition. A condensed but
 * spec-compliant subset suitable for `/Schemas` discovery.
 */
export const userSchema: ScimSchema = {
  id: UserSchemaId,
  name: 'User',
  description: 'User Account',
  meta: { resourceType: 'Schema', location: `/Schemas/${UserSchemaId}` },
  attributes: [
    {
      name: 'userName',
      type: 'string',
      multiValued: false,
      description: 'Unique identifier for the User, typically used by the user to directly authenticate.',
      required: true,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'server',
    },
    {
      name: 'name',
      type: 'complex',
      multiValued: false,
      description: 'The components of the user\'s real name.',
      required: false,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'none',
      subAttributes: [
        { name: 'formatted', type: 'string', multiValued: false, description: 'Full name formatted for display.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
        { name: 'familyName', type: 'string', multiValued: false, description: 'Family name (last name).', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
        { name: 'givenName', type: 'string', multiValued: false, description: 'Given name (first name).', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
        { name: 'middleName', type: 'string', multiValued: false, description: 'Middle name.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
        { name: 'honorificPrefix', type: 'string', multiValued: false, description: 'Honorific prefix (e.g., Ms., Dr.).', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
        { name: 'honorificSuffix', type: 'string', multiValued: false, description: 'Honorific suffix (e.g., Jr., III).', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      ],
    },
    { name: 'displayName', type: 'string', multiValued: false, description: 'Name displayed to end-users.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'nickName', type: 'string', multiValued: false, description: 'Casual name of the User.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'profileUrl', type: 'reference', multiValued: false, description: 'URL of the User\'s online profile.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', referenceTypes: ['external'] },
    { name: 'title', type: 'string', multiValued: false, description: 'Title of the User.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'userType', type: 'string', multiValued: false, description: 'Used to identify the relationship between the organization and the user.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'preferredLanguage', type: 'string', multiValued: false, description: 'Preferred language as per RFC 7231.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'locale', type: 'string', multiValued: false, description: 'Default location of the User.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'timezone', type: 'string', multiValued: false, description: 'Time zone in IANA format.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'active', type: 'boolean', multiValued: false, description: 'Whether the user is active.', required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'password', type: 'string', multiValued: false, description: 'Cleartext password (write-only).', required: false, caseExact: false, mutability: 'writeOnly', returned: 'never', uniqueness: 'none' },
    {
      name: 'emails',
      type: 'complex',
      multiValued: true,
      description: 'Email addresses for the user.',
      required: false,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'none',
      subAttributes: multiValuedSubAttrs('email'),
    },
    {
      name: 'phoneNumbers',
      type: 'complex',
      multiValued: true,
      description: 'Phone numbers for the user.',
      required: false,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'none',
      subAttributes: multiValuedSubAttrs('phone'),
    },
    {
      name: 'groups',
      type: 'complex',
      multiValued: true,
      description: 'Groups the user is a member of (read-only).',
      required: false,
      mutability: 'readOnly',
      returned: 'default',
      uniqueness: 'none',
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, description: 'Identifier of the Group.', required: false, caseExact: true, mutability: 'readOnly', returned: 'default', uniqueness: 'none' },
        { name: '$ref', type: 'reference', multiValued: false, description: 'URI of the Group resource.', required: false, caseExact: true, mutability: 'readOnly', returned: 'default', uniqueness: 'none', referenceTypes: ['Group'] },
        { name: 'display', type: 'string', multiValued: false, description: 'Human-readable Group name.', required: false, caseExact: false, mutability: 'readOnly', returned: 'default', uniqueness: 'none' },
        { name: 'type', type: 'string', multiValued: false, description: 'Membership type.', required: false, caseExact: false, mutability: 'readOnly', returned: 'default', uniqueness: 'none', canonicalValues: ['direct', 'indirect'] },
      ],
    },
  ],
};

function multiValuedSubAttrs(kind: string): ScimAttributeDefinition[] {
  return [
    { name: 'value', type: 'string', multiValued: false, description: `${kind} value.`, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'display', type: 'string', multiValued: false, description: 'Human-readable display value.', required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'type', type: 'string', multiValued: false, description: `Function of the ${kind} (e.g., work, home).`, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'primary', type: 'boolean', multiValued: false, description: 'Whether this is the primary value.', required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
  ];
}
