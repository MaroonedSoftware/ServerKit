import { ScimAttributeDefinition, ScimSchema } from '../schemas/schema.types.js';

/**
 * Requested attribute projection for a SCIM response, from the `attributes` and
 * `excludedAttributes` query parameters (RFC 7644 §3.9). The two are mutually
 * exclusive; when a client sends both, `attributes` wins, being the more
 * restrictive of the pair.
 */
export interface ScimProjection {
  /** Attribute paths to return, in addition to those whose `returned` is `'always'`. */
  attributes?: string[];
  /** Attribute paths to omit. Attributes whose `returned` is `'always'` are never omitted. */
  excludedAttributes?: string[];
}

/**
 * Attributes every SCIM resource carries regardless of projection. RFC 7643 §7
 * treats `id`, `schemas`, and `meta` as `returned: 'always'`, but they are not
 * listed in the core schemas' `attributes` arrays, so they are matched by name.
 */
const ALWAYS_RETURNED = new Set(['id', 'schemas', 'meta']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Split an attribute path into segments, tolerating the fully-qualified form
 * clients send for extension attributes
 * (`urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department`).
 * The URN prefix becomes its own leading segment so it lines up with the
 * extension's top-level key on the resource.
 */
const splitPath = (path: string): string[] => {
  const urnBoundary = path.lastIndexOf(':');
  if (urnBoundary === -1) return path.split('.');
  return [path.slice(0, urnBoundary), ...path.slice(urnBoundary + 1).split('.')];
};

/**
 * A set of requested attribute paths. Comparisons are case-insensitive, as SCIM
 * attribute names are (RFC 7643 §2.1).
 */
class PathSet {
  private readonly paths: string[][];

  constructor(paths: string[]) {
    this.paths = paths.map(p => splitPath(p).map(s => s.toLowerCase()));
  }

  get empty(): boolean {
    return this.paths.length === 0;
  }

  /** Whether `segments` is at or above a requested path — `name` matches a request for `name.givenName`. */
  coversOrLeadsTo(segments: string[]): boolean {
    const target = segments.map(s => s.toLowerCase());
    return this.paths.some(path => {
      const shared = Math.min(path.length, target.length);
      for (let i = 0; i < shared; i++) {
        if (path[i] !== target[i]) return false;
      }
      return true;
    });
  }

  /** Whether `segments` is at or below a requested path — `name.givenName` matches a request for `name`. */
  isAtOrBelow(segments: string[]): boolean {
    const target = segments.map(s => s.toLowerCase());
    return this.paths.some(path => {
      if (path.length > target.length) return false;
      return path.every((segment, i) => segment === target[i]);
    });
  }
}

const findDefinition = (definitions: ScimAttributeDefinition[], name: string): ScimAttributeDefinition | undefined =>
  definitions.find(d => d.name.toLowerCase() === name.toLowerCase());

type ProjectionMode = 'include' | 'exclude' | 'default';

/**
 * Project a SCIM resource for the wire.
 *
 * Two things happen here, and only the first is optional:
 *
 * 1. `attributes` / `excludedAttributes` are applied, per RFC 7644 §3.9.
 * 2. Attributes the schema declares `returned: 'never'` are stripped
 *    unconditionally. `password` is the one that matters: it is `writeOnly` and
 *    `never`, so a repository that round-trips whatever it stored must not be
 *    able to hand it back to a provisioning client.
 *
 * Attributes declared `returned: 'request'` come back only when named in
 * `attributes`. Keys no schema defines — a repository's own bookkeeping field,
 * an extension the caller did not declare — are kept unless a projection
 * excludes them, since the package cannot know they are safe to drop.
 *
 * @param resource - The resource to project. Not mutated.
 * @param schemas  - The resource's schemas: the core one first, then any
 *   extensions. An extension's attributes are matched under the resource key
 *   named by its schema `id`.
 * @param projection - The requested projection; omit for schema rules only.
 * @returns A new resource object with the projection applied.
 */
export const projectScimResource = <T extends Record<string, unknown>>(
  resource: T,
  schemas: ScimSchema[],
  projection: ScimProjection = {},
): T => {
  const requested = new PathSet(projection.attributes ?? []);
  const excluded = new PathSet(projection.excludedAttributes ?? []);
  const mode: ProjectionMode = !requested.empty ? 'include' : !excluded.empty ? 'exclude' : 'default';

  const [core, ...extensions] = schemas;
  const extensionsById = new Map(extensions.map(schema => [schema.id.toLowerCase(), schema]));

  return projectObject(resource, core?.attributes ?? [], extensionsById, [], mode, requested, excluded) as T;
};

const projectObject = (
  source: Record<string, unknown>,
  definitions: ScimAttributeDefinition[],
  extensionsById: Map<string, ScimSchema>,
  prefix: string[],
  mode: ProjectionMode,
  requested: PathSet,
  excluded: PathSet,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    const segments = [...prefix, key];
    const extension = prefix.length === 0 ? extensionsById.get(key.toLowerCase()) : undefined;
    const definition = findDefinition(definitions, key);
    const alwaysReturned = definition?.returned === 'always' || (prefix.length === 0 && ALWAYS_RETURNED.has(key.toLowerCase()));

    if (definition?.returned === 'never') continue;

    if (!alwaysReturned) {
      if (mode === 'include' && !requested.coversOrLeadsTo(segments)) continue;
      if (mode === 'exclude' && excluded.isAtOrBelow(segments)) continue;
      if (mode !== 'include' && definition?.returned === 'request') continue;
    }

    // A schema extension is a nested object keyed by its URN; its attributes are
    // defined by the extension schema, not by the core one.
    if (extension && isPlainObject(value)) {
      out[key] = projectObject(value, extension.attributes, extensionsById, segments, mode, requested, excluded);
      continue;
    }

    const subDefinitions = definition?.subAttributes;
    if (subDefinitions && Array.isArray(value)) {
      out[key] = value.map(entry =>
        isPlainObject(entry) ? projectObject(entry, subDefinitions, extensionsById, segments, mode, requested, excluded) : entry,
      );
      continue;
    }
    if (subDefinitions && isPlainObject(value)) {
      out[key] = projectObject(value, subDefinitions, extensionsById, segments, mode, requested, excluded);
      continue;
    }

    out[key] = value;
  }

  return out;
};
