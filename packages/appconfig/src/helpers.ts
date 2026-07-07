/**
 * Attempts to parse a string as JSON, returning the original string if parsing fails.
 *
 * @param text - The text to parse.
 * @returns The parsed JSON value, or the original text if parsing fails.
 */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text, (_, value) => value);
  } catch {
    return text;
  }
}

/**
 * Reads a value from a nested object by a dot-separated path. Numeric segments index into
 * arrays (`servers.0.host`). Returns `undefined` if any segment is missing or traverses a
 * non-object — the keyed-`get` projection used by the file sources.
 *
 * @param root - The object to read from.
 * @param path - A dot-separated path (e.g. `database.host`).
 * @returns The value at the path, or `undefined`.
 */
export function getByPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Recursively compares two values for structural equality.
 *
 * Used to suppress no-op config-reload notifications: a secret re-fetched from a
 * secret manager often produces a value that is structurally identical to the
 * one already held, and reloading it should not bounce live consumers (e.g. a DB
 * pool listening via `onChange`).
 *
 * Handles primitives, arrays, and plain objects by value. Two `NaN`s compare as
 * unequal (matching `===` semantics); functions and other exotic values compare
 * by reference. Key order is ignored for objects.
 *
 * @param a - The first value to compare.
 * @param b - The second value to compare.
 * @returns `true` if the values are structurally equal, `false` otherwise.
 */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => structurallyEqual(item, b[index]));
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every(key => Object.prototype.hasOwnProperty.call(bRecord, key) && structurallyEqual(aRecord[key], bRecord[key]));
}

/**
 * Transforms a flat key/value record into a nested object by splitting keys on a
 * separator string.
 *
 * Each key is split into path segments. Intermediate objects are created as needed.
 * If a path segment collides with an existing non-object value it is replaced by the
 * new object. Keys that do not contain the separator are passed through unchanged.
 *
 * Supports arbitrary nesting depth — a key with N separators produces N+1 levels.
 *
 * Path segments equal to `__proto__`, `constructor`, or `prototype` are rejected: without
 * this guard a key whose segments include `__proto__` would walk onto (and mutate) the
 * shared `Object.prototype`, a classic prototype-pollution vector when the record originates
 * from untrusted env/config input.
 *
 * @param record    - The flat key/value record to transform.
 * @param separator - The string used to delimit path segments (e.g. `'__'`).
 * @returns A new nested object.
 * @throws {Error} When any key contains a `__proto__`, `constructor`, or `prototype` segment.
 *
 * @example
 * ```typescript
 * nestKeys(
 *   {
 *     WEBHOOK__secret: 'abc',
 *     WEBHOOK__header: 'X-Sig',
 *     DATABASE_URL: 'postgres://localhost/db',
 *   },
 *   '__',
 * );
 * // → { WEBHOOK: { secret: 'abc', header: 'X-Sig' }, DATABASE_URL: 'postgres://localhost/db' }
 * ```
 */
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function nestKeys(record: Record<string, unknown>, separator: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    const parts = key.split(separator);

    if (parts.some(part => FORBIDDEN_PATH_SEGMENTS.has(part))) {
      throw new Error(`nestKeys: refusing to build a path through a forbidden key segment in "${key}"`);
    }

    if (parts.length === 1) {
      result[key] = value;
    } else {
      let current = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        if (typeof current[part] !== 'object' || current[part] === null) {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }
      current[parts[parts.length - 1]!] = value;
    }
  }

  return result;
}
