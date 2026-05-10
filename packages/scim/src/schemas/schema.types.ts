/**
 * Shape of a SCIM schema document (RFC 7643 §7).
 * Used for the `/Schemas` discovery endpoint output and to describe
 * resource extensions.
 */
export interface ScimSchema {
  id: string;
  name: string;
  description: string;
  attributes: ScimAttributeDefinition[];
  meta: {
    resourceType: 'Schema';
    location?: string;
  };
}

/**
 * Definition of a single attribute on a SCIM schema.
 */
export interface ScimAttributeDefinition {
  name: string;
  type: 'string' | 'boolean' | 'decimal' | 'integer' | 'dateTime' | 'reference' | 'binary' | 'complex';
  subAttributes?: ScimAttributeDefinition[];
  multiValued: boolean;
  description: string;
  required: boolean;
  caseExact?: boolean;
  mutability: 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly';
  returned: 'always' | 'never' | 'default' | 'request';
  uniqueness: 'none' | 'server' | 'global';
  canonicalValues?: string[];
  referenceTypes?: string[];
}
