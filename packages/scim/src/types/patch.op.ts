/**
 * Schema URI for the SCIM PatchOp message (RFC 7644 §3.5.2).
 */
export const PatchOpSchema = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/**
 * Operation kinds permitted in a SCIM PATCH request.
 * Case-insensitive on the wire; normalised internally.
 */
export type ScimPatchOpKind = 'add' | 'replace' | 'remove';

/**
 * A single PATCH operation as it appears in a PatchOp request body.
 */
export interface ScimPatchOp {
  op: ScimPatchOpKind | Uppercase<ScimPatchOpKind> | Capitalize<ScimPatchOpKind>;
  path?: string;
  value?: unknown;
}

/**
 * The full PatchOp request envelope.
 */
export interface ScimPatchRequest {
  schemas: [typeof PatchOpSchema];
  Operations: ScimPatchOp[];
}
