/**
 * The `meta` complex attribute attached to every SCIM resource.
 * See RFC 7643 §3.1.
 */
export interface ScimMeta {
  /** The name of the resource type (e.g. `User`, `Group`). */
  resourceType: string;
  /** ISO 8601 timestamp when the resource was first created. */
  created?: string;
  /** ISO 8601 timestamp when the resource was last modified. */
  lastModified?: string;
  /** Absolute URI for the resource. */
  location?: string;
  /** Opaque entity tag for optimistic concurrency. */
  version?: string;
}

/**
 * Common properties shared by every SCIM resource (RFC 7643 §3).
 */
export interface ScimCommonAttributes {
  /** Server-assigned unique identifier. */
  id: string;
  /** Identifier supplied by the provisioning client. */
  externalId?: string;
  /** Schema URIs declared by this resource. */
  schemas: string[];
  /** Resource metadata (`resourceType`, `created`, `lastModified`, etc.). */
  meta: ScimMeta;
}
