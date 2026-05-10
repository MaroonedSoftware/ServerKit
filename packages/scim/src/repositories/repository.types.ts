import type { ScimFilterNode } from '../filter/filter.ast.js';

/**
 * Sort direction supported by SCIM list endpoints (RFC 7644 §3.4.2.3).
 */
export type ScimSortOrder = 'ascending' | 'descending';

/**
 * Parsed query parameters for a SCIM list/search request.
 * The repository receives the parsed filter AST (or `undefined`); it does not
 * see the raw query-string form, so backend translation is the only concern.
 */
export interface ScimListQuery {
  /** Parsed filter AST, or `undefined` when the request omits `filter`. */
  filter?: ScimFilterNode;
  /** 1-based start index, defaulting to 1 per RFC 7644 §3.4.2.4. */
  startIndex: number;
  /** Page size, capped by the server's configured maxResults. */
  count: number;
  /** Attribute name to sort by, if any. */
  sortBy?: string;
  /** Sort direction (defaults to ascending when sortBy is set). */
  sortOrder?: ScimSortOrder;
  /** Attributes to include in the response (`attributes` query param). */
  attributes?: string[];
  /** Attributes to exclude from the response (`excludedAttributes` query param). */
  excludedAttributes?: string[];
}

/**
 * The result of a list operation: the page of resources and the total count
 * that match the filter (used to populate `totalResults`).
 */
export interface ScimListResult<TResource> {
  resources: TResource[];
  totalResults: number;
}
