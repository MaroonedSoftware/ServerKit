import type { ScimCommonAttributes } from './scim.meta.js';

/** Member reference embedded in a Group. */
export interface ScimGroupMember {
  value: string;
  $ref?: string;
  display?: string;
  type?: 'User' | 'Group';
}

/** RFC 7643 §4.2: Group resource. */
export interface ScimGroup extends ScimCommonAttributes {
  displayName: string;
  members?: ScimGroupMember[];
}
