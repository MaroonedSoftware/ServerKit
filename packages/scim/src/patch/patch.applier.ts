import { scimError } from '../errors/scim.error.js';
import { parseScimFilter } from '../filter/filter.parser.js';
import type { ScimFilterNode } from '../filter/filter.ast.js';
import type { ScimPatchOp, ScimPatchOpKind } from '../types/patch.op.js';

/**
 * Apply a SCIM PATCH operation list to a resource (RFC 7644 §3.5.2).
 * Returns a *new* object — the input is not mutated.
 *
 * Supports the standard `add` / `replace` / `remove` operations and the path
 * mini-language including dotted sub-attributes and value-path filters
 * (e.g. `emails[type eq "work"].value`).
 */
export const applyScimPatch = <T extends Record<string, unknown>>(resource: T, ops: ScimPatchOp[]): T => {
  // Deep-clone so mutations don't leak to the caller.
  let next: Record<string, unknown> = structuredClone(resource);
  for (const op of ops) {
    next = applyOne(next, op);
  }
  return next as T;
};

const applyOne = (resource: Record<string, unknown>, op: ScimPatchOp): Record<string, unknown> => {
  const kind = normaliseOpKind(op.op);

  if (op.path === undefined || op.path === '') {
    if (kind === 'remove') {
      throw scimError(400, 'noTarget', 'Bad Request').withDetails({ message: '"remove" requires a path' });
    }
    if (typeof op.value !== 'object' || op.value === null || Array.isArray(op.value)) {
      throw scimError(400, 'invalidValue', 'Bad Request').withDetails({ message: 'Pathless add/replace requires an object value' });
    }
    return mergeObject(resource, op.value as Record<string, unknown>, kind);
  }

  const path = parsePatchPath(op.path);
  return applyAtPath(resource, path, kind, op.value);
};

const normaliseOpKind = (op: ScimPatchOp['op']): ScimPatchOpKind => {
  const lower = String(op).toLowerCase();
  if (lower === 'add' || lower === 'replace' || lower === 'remove') return lower;
  throw scimError(400, 'invalidSyntax', 'Bad Request').withDetails({ message: `Unknown PATCH op "${op}"` });
};

interface ParsedPath {
  /** Top-level attribute, possibly with sub-attribute segments. */
  segments: string[];
  /** Optional value-path filter applied to the leaf attribute. */
  filter?: ScimFilterNode;
  /** Sub-attribute applied after the value-path filter (e.g. `.value`). */
  filterSubAttr?: string;
}

const parsePatchPath = (raw: string): ParsedPath => {
  // Split off optional `[...]filter` segment.
  const bracketStart = raw.indexOf('[');
  if (bracketStart === -1) {
    return { segments: raw.split('.').filter(Boolean) };
  }

  const bracketEnd = findMatchingBracket(raw, bracketStart);
  if (bracketEnd === -1) {
    throw scimError(400, 'invalidPath', 'Bad Request').withDetails({ message: 'Unterminated value-path filter' });
  }

  const head = raw.slice(0, bracketStart);
  const filterSrc = raw.slice(bracketStart + 1, bracketEnd);
  const tail = raw.slice(bracketEnd + 1);

  const segments = head.split('.').filter(Boolean);
  if (segments.length === 0) {
    throw scimError(400, 'invalidPath', 'Bad Request').withDetails({ message: 'Value-path filter requires a target attribute' });
  }

  const filter = parseScimFilter(filterSrc);

  let filterSubAttr: string | undefined;
  if (tail.length > 0) {
    if (!tail.startsWith('.')) {
      throw scimError(400, 'invalidPath', 'Bad Request').withDetails({ message: 'Expected "." after value-path filter' });
    }
    filterSubAttr = tail.slice(1);
    if (filterSubAttr.length === 0 || filterSubAttr.includes('[')) {
      throw scimError(400, 'invalidPath', 'Bad Request').withDetails({ message: 'Invalid sub-attribute after value-path filter' });
    }
  }

  return { segments, filter, filterSubAttr };
};

const findMatchingBracket = (input: string, openIndex: number): number => {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < input.length; i += 1) {
    const ch = input[i]!;
    if (inString) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const applyAtPath = (resource: Record<string, unknown>, path: ParsedPath, kind: ScimPatchOpKind, value: unknown): Record<string, unknown> => {
  const [head, ...rest] = path.segments;
  if (!head) {
    throw scimError(400, 'invalidPath', 'Bad Request').withDetails({ message: 'Empty PATCH path' });
  }

  if (path.filter && rest.length === 0) {
    return applyFilteredOp(resource, head, path.filter, path.filterSubAttr, kind, value);
  }

  if (rest.length === 0) {
    return applySimpleOp(resource, head, kind, value);
  }

  const child = resource[head];
  const childObj: Record<string, unknown> = isPlainObject(child) ? { ...child } : {};
  const updated = applyAtPath(childObj, { ...path, segments: rest }, kind, value);
  return { ...resource, [head]: updated };
};

const applySimpleOp = (resource: Record<string, unknown>, attr: string, kind: ScimPatchOpKind, value: unknown): Record<string, unknown> => {
  if (kind === 'remove') {
    const next = { ...resource };
    delete next[attr];
    return next;
  }

  if (kind === 'replace') {
    return { ...resource, [attr]: value };
  }

  // add: for multi-valued attributes, append; otherwise replace.
  const existing = resource[attr];
  if (Array.isArray(existing) && Array.isArray(value)) {
    return { ...resource, [attr]: [...existing, ...value] };
  }
  if (Array.isArray(existing) && value !== undefined) {
    return { ...resource, [attr]: [...existing, value] };
  }
  if (existing === undefined && Array.isArray(value)) {
    return { ...resource, [attr]: [...value] };
  }
  if (isPlainObject(existing) && isPlainObject(value)) {
    return { ...resource, [attr]: { ...existing, ...value } };
  }
  return { ...resource, [attr]: value };
};

const applyFilteredOp = (
  resource: Record<string, unknown>,
  attr: string,
  filter: ScimFilterNode,
  subAttr: string | undefined,
  kind: ScimPatchOpKind,
  value: unknown,
): Record<string, unknown> => {
  const collection = resource[attr];
  if (!Array.isArray(collection)) {
    if (kind === 'add') {
      // Per RFC, add on a non-existent target creates it. For value-path on a
      // missing collection, the closest behaviour is to materialise the matched
      // item from the supplied value.
      return { ...resource, [attr]: [{ ...(value as Record<string, unknown>) }] };
    }
    throw scimError(400, 'noTarget', 'Bad Request').withDetails({ message: `Attribute "${attr}" is not multi-valued` });
  }

  const matched: number[] = [];
  collection.forEach((item, index) => {
    if (isPlainObject(item) && evaluateFilter(item, filter)) matched.push(index);
  });

  if (matched.length === 0 && kind !== 'add') {
    throw scimError(400, 'noTarget', 'Bad Request').withDetails({ message: `No items matched value-path filter on "${attr}"` });
  }

  if (kind === 'remove') {
    const next = collection.filter((_, idx) => !matched.includes(idx));
    return { ...resource, [attr]: next };
  }

  if (kind === 'add' && matched.length === 0) {
    const seed = isPlainObject(value) ? { ...value } : { value };
    return { ...resource, [attr]: [...collection, seed] };
  }

  const next = collection.map((item, idx) => {
    if (!matched.includes(idx) || !isPlainObject(item)) return item;
    if (subAttr !== undefined) {
      if (kind === 'replace' || kind === 'add') {
        return { ...item, [subAttr]: value };
      }
    }
    if (kind === 'replace') {
      return isPlainObject(value) ? { ...item, ...value } : value;
    }
    // add: shallow merge
    return isPlainObject(value) ? { ...item, ...value } : item;
  });
  return { ...resource, [attr]: next };
};

const mergeObject = (target: Record<string, unknown>, source: Record<string, unknown>, kind: ScimPatchOpKind): Record<string, unknown> => {
  if (kind === 'replace') {
    return { ...target, ...source };
  }
  // add: deep-merge for nested objects, append for arrays
  const out: Record<string, unknown> = { ...target };
  for (const [key, val] of Object.entries(source)) {
    const existing = out[key];
    if (Array.isArray(existing) && Array.isArray(val)) {
      out[key] = [...existing, ...val];
    } else if (isPlainObject(existing) && isPlainObject(val)) {
      out[key] = mergeObject(existing, val, kind);
    } else {
      out[key] = val;
    }
  }
  return out;
};

const evaluateFilter = (item: Record<string, unknown>, filter: ScimFilterNode): boolean => {
  switch (filter.kind) {
    case 'comparison':
      return evaluateComparison(item, filter.attribute, filter.operator, filter.value);
    case 'logical':
      return filter.operator === 'and'
        ? evaluateFilter(item, filter.left) && evaluateFilter(item, filter.right)
        : evaluateFilter(item, filter.left) || evaluateFilter(item, filter.right);
    case 'not':
      return !evaluateFilter(item, filter.filter);
    case 'valuePath': {
      const nested = item[filter.attribute];
      if (!Array.isArray(nested)) return false;
      return nested.some(child => isPlainObject(child) && evaluateFilter(child, filter.filter));
    }
  }
};

const evaluateComparison = (item: Record<string, unknown>, attr: string, op: string, value: unknown): boolean => {
  const segments = attr.split('.');
  let current: unknown = item;
  for (const seg of segments) {
    if (!isPlainObject(current)) return false;
    current = current[seg];
  }
  if (op === 'pr') return current !== undefined && current !== null && current !== '';
  if (current === undefined || current === null) return false;

  switch (op) {
    case 'eq':
      return current === value;
    case 'ne':
      return current !== value;
    case 'co':
      return typeof current === 'string' && typeof value === 'string' && current.toLowerCase().includes(value.toLowerCase());
    case 'sw':
      return typeof current === 'string' && typeof value === 'string' && current.toLowerCase().startsWith(value.toLowerCase());
    case 'ew':
      return typeof current === 'string' && typeof value === 'string' && current.toLowerCase().endsWith(value.toLowerCase());
    case 'gt':
      return compareScalar(current, value) > 0;
    case 'ge':
      return compareScalar(current, value) >= 0;
    case 'lt':
      return compareScalar(current, value) < 0;
    case 'le':
      return compareScalar(current, value) <= 0;
    default:
      return false;
  }
};

const compareScalar = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};
