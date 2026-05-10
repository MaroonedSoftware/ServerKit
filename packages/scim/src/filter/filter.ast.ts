/**
 * SCIM filter comparison operators (RFC 7644 §3.4.2.2).
 */
export type ScimComparisonOperator = 'eq' | 'ne' | 'co' | 'sw' | 'ew' | 'gt' | 'ge' | 'lt' | 'le' | 'pr';

/**
 * SCIM filter logical operators.
 */
export type ScimLogicalOperator = 'and' | 'or';

/**
 * Comparison node: `<attrPath> <op> <value>` or `<attrPath> pr` (presence).
 */
export interface ScimFilterComparison {
  kind: 'comparison';
  /** Attribute path, e.g. `userName`, `name.familyName`, `urn:.../User:userName`. */
  attribute: string;
  operator: ScimComparisonOperator;
  /** Literal value; absent for `pr` (presence). */
  value?: string | number | boolean | null;
}

/** Boolean conjunction / disjunction. */
export interface ScimFilterLogical {
  kind: 'logical';
  operator: ScimLogicalOperator;
  left: ScimFilterNode;
  right: ScimFilterNode;
}

/** Negation: `not(<filter>)`. */
export interface ScimFilterNot {
  kind: 'not';
  filter: ScimFilterNode;
}

/** Value-path filter: `emails[type eq "work" and primary eq true]`. */
export interface ScimFilterValuePath {
  kind: 'valuePath';
  attribute: string;
  filter: ScimFilterNode;
}

/** Discriminated union of every parsed SCIM filter node. */
export type ScimFilterNode = ScimFilterComparison | ScimFilterLogical | ScimFilterNot | ScimFilterValuePath;
