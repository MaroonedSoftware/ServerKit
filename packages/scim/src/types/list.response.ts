/**
 * Schema URI for the SCIM ListResponse message (RFC 7644 §3.4.2).
 */
export const ListResponseSchema = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';

/**
 * SCIM ListResponse envelope returned from list/search endpoints.
 */
export interface ScimListResponse<TResource> {
  schemas: [typeof ListResponseSchema];
  totalResults: number;
  startIndex?: number;
  itemsPerPage?: number;
  Resources?: TResource[];
}
