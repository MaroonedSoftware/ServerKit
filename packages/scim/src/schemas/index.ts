export * from './schema.types.js';
export * from './user.schema.js';
export * from './group.schema.js';
export * from './enterprise.user.schema.js';
export * from './resource.type.schema.js';
export * from './service.provider.config.schema.js';

import { userSchema } from './user.schema.js';
import { groupSchema } from './group.schema.js';
import { enterpriseUserSchema } from './enterprise.user.schema.js';

/** All SCIM core + extension schemas this package ships. */
export const coreSchemas = [userSchema, groupSchema, enterpriseUserSchema];
