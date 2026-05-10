import { UserSchemaId } from './user.schema.js';
import { GroupSchemaId } from './group.schema.js';
import { EnterpriseUserSchemaId } from './enterprise.user.schema.js';

/** Schema URI for the SCIM ResourceType resource. */
export const ResourceTypeSchemaId = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType';

export interface ScimResourceType {
  schemas: [typeof ResourceTypeSchemaId];
  id: string;
  name: string;
  endpoint: string;
  description: string;
  schema: string;
  schemaExtensions?: Array<{ schema: string; required: boolean }>;
  meta: {
    resourceType: 'ResourceType';
    location?: string;
  };
}

export const userResourceType: ScimResourceType = {
  schemas: [ResourceTypeSchemaId],
  id: 'User',
  name: 'User',
  endpoint: '/Users',
  description: 'User Account',
  schema: UserSchemaId,
  schemaExtensions: [{ schema: EnterpriseUserSchemaId, required: false }],
  meta: { resourceType: 'ResourceType', location: '/ResourceTypes/User' },
};

export const groupResourceType: ScimResourceType = {
  schemas: [ResourceTypeSchemaId],
  id: 'Group',
  name: 'Group',
  endpoint: '/Groups',
  description: 'Group',
  schema: GroupSchemaId,
  meta: { resourceType: 'ResourceType', location: '/ResourceTypes/Group' },
};
