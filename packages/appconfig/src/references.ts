import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Options for {@link resolveReferences}.
 *
 * @property pattern - The reference token pattern, with one capture group extracting the
 *   dotted path. Defaults to `/\$\{ref:([^}]+)\}/g`. A non-global pattern is upgraded to
 *   global automatically (the matcher requires it).
 */
export interface ResolveReferencesOptions {
  pattern?: RegExp;
}

const DEFAULT_PATTERN = /\$\{ref:([^}]+)\}/g;

/**
 * Resolves intra-config `${ref:some.path}` references in place, against the config tree
 * itself.
 *
 * This is a deliberately separate pass from {@link import('./resolve.js').resolveValues} —
 * not a resolver — because it has a fundamentally different execution model: the source of
 * truth is the very object being mutated, so references must resolve in dependency order
 * (not independently), and cycles must be detected. Run it **after** the resolver pass, so
 * references resolve against a tree where all external values (env, secrets) are already
 * concrete; the builder does exactly this when {@link import('./app.config.builder.js').AppConfigBuilder.resolveReferences}
 * is enabled.
 *
 * Two substitution modes, chosen automatically:
 * - **whole-value** — when a value is exactly one reference token (`port: '${ref:defaults.port}'`),
 *   the referenced value replaces it *by identity*, preserving its type (number, object, …).
 * - **interpolation** — otherwise (`url: '${ref:host}:${ref:port}'`), each reference is
 *   stringified and spliced into the surrounding text. Referencing a non-primitive
 *   (object/array) in this mode is an error.
 *
 * Paths split on `.`; numeric segments index into arrays (`servers.0.host`).
 *
 * @param root - The config object whose `${ref:…}` references are resolved in place.
 * @param options - Optional pattern override.
 * @throws {ServerkitError} On a reference cycle, a reference to a missing path, or a
 *   non-primitive value used in string interpolation.
 */
export function resolveReferences(root: object, options?: ResolveReferencesOptions): void {
  const base = options?.pattern ?? DEFAULT_PATTERN;
  const pattern = base.global ? base : new RegExp(base.source, base.flags + 'g');

  const hasRef = (value: string): boolean => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  };

  /** Locates the container object and final key for a dotted path, or `undefined`. */
  const locate = (path: string): { container: Record<string, unknown>; key: string } | undefined => {
    const parts = path.split('.');
    let current: unknown = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current === null || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[parts[i]!];
    }
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    return { container: current as Record<string, unknown>, key: parts[parts.length - 1]! };
  };

  /** Resolves the value at `path`, following `${ref:…}` chains and writing results back. */
  const resolvePath = (path: string, seen: string[]): unknown => {
    if (seen.includes(path)) {
      throw new ServerkitError(`AppConfig reference cycle: ${[...seen, path].join(' → ')}`);
    }
    const loc = locate(path);
    if (!loc || !(loc.key in loc.container) || loc.container[loc.key] === undefined) {
      throw new ServerkitError(`AppConfig reference "${path}" does not resolve to a value`);
    }
    const raw = loc.container[loc.key];
    if (typeof raw === 'string' && hasRef(raw)) {
      const resolved = resolveString(raw, [...seen, path]);
      loc.container[loc.key] = resolved;
      return resolved;
    }
    return raw;
  };

  /** Resolves all references within a single string value. */
  const resolveString = (value: string, seen: string[]): unknown => {
    // Reset before `matchAll`: a prior `hasRef` `.test()` advances the shared regex's
    // `lastIndex`, and `matchAll` seeds its iterator from it — which would skip the match.
    pattern.lastIndex = 0;
    const matches = [...value.matchAll(pattern)];

    // Whole-value reference: the entire string is one token → substitute by identity.
    if (matches.length === 1 && matches[0]![0].length === value.length) {
      return resolvePath(matches[0]![1]!.trim(), seen);
    }

    // Interpolation: splice each referenced value into the surrounding text.
    let result = value;
    for (const match of matches) {
      const referenced = resolvePath(match[1]!.trim(), seen);
      if (referenced !== null && typeof referenced === 'object') {
        throw new ServerkitError(`AppConfig reference "${match[1]!.trim()}" resolves to a non-primitive and cannot be interpolated into "${value}"`);
      }
      result = result.replaceAll(match[0], String(referenced));
    }
    return result;
  };

  // Collect every string leaf that contains a reference, then resolve each. resolvePath
  // rewrites in place and short-circuits on already-resolved values, so resolving the
  // collected leaves resolves the whole tree (and any paths they transitively reference).
  const referencingPaths: string[] = [];
  const collect = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    const entries = Array.isArray(node) ? node.map((v, i) => [String(i), v] as const) : Object.entries(node);
    for (const [key, child] of entries) {
      const childPath = path ? `${path}.${key}` : key;
      if (typeof child === 'string') {
        if (hasRef(child)) {
          referencingPaths.push(childPath);
        }
      } else {
        collect(child, childPath);
      }
    }
  };
  collect(root, '');

  for (const path of referencingPaths) {
    resolvePath(path, []);
  }
}
