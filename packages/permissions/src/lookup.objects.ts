import type { AuthorizationModel, RelationDef, UsersetExpr } from './dsl.js';
import type { PermissionsTupleRepository } from './tuples.repository.js';
import { type ObjectRef, type SubjectRef, OBJECT_WILDCARD } from './tuple.js';
import { checkDetailed } from './check.js';
import { type CheckOptions, resolveMaxDepth } from './check.options.js';

/** The outcome of {@link lookupObjects}. */
export interface LookupObjectsResult {
  /** Objects on which the subject holds the permission, each confirmed by a Check. */
  objects: ObjectRef[];
  /**
   * True when an every-object tuple (`doc:*`) reached the permission. The subject
   * may then hold it on objects that are not in `objects`, because a `*` grant
   * covers objects that no tuple names. It is a candidate, not a confirmed answer:
   * an exclusion or intersection can still deny a given object, so `check` the
   * object you care about.
   */
  everyObject: boolean;
  /**
   * True when the reverse walk or a confirming Check hit
   * {@link CheckOptions.maxDepth}. `objects` may then be missing entries.
   */
  maxDepthExceeded: boolean;
  /** Number of concrete candidates the walk produced before confirmation. */
  candidates: number;
}

interface RelationKey {
  namespace: string;
  relation: string;
}

interface TupleToUsersetEdge {
  namespace: string;
  tupleRelation: string;
  permission: string;
}

/**
 * Reverse view of an {@link AuthorizationModel}: for each thing a subject can
 * come to hold, what that in turn grants. Built once per model.
 */
interface ReverseIndex {
  /** Relations that accept a concrete subject of a namespace, keyed by that namespace. */
  concrete: Map<string, RelationKey[]>;
  /** Relations that accept the `ns.*` subject, keyed by namespace. */
  wildcard: Map<string, RelationKey[]>;
  /** Relations that accept the userset subject `ns.relation`, keyed `ns.relation`. */
  userset: Map<string, RelationKey[]>;
  /** Permissions that hold whenever `ns.name` holds on the same object, keyed `ns.name`. */
  computed: Map<string, string[]>;
  /** `tupleToUserset` edges whose walked relation is `ns.name` on the parent, keyed `ns.name`. */
  tupleToUserset: Map<string, TupleToUsersetEdge[]>;
}

const indexes = new WeakMap<AuthorizationModel, ReverseIndex>();

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const parseSubjectType = (s: string): { namespace: string; relation?: string; wildcard: boolean } => {
  if (s.endsWith('.*')) return { namespace: s.slice(0, -2), wildcard: true };
  const dot = s.indexOf('.');
  if (dot !== -1) return { namespace: s.slice(0, dot), relation: s.slice(dot + 1), wildcard: false };
  return { namespace: s, wildcard: false };
};

/**
 * Leaves that can make a permission true. `exclusion` contributes only its
 * base: the subtracted side can never grant, and the confirming Check applies it.
 */
const positiveLeaves = (expr: UsersetExpr, out: UsersetExpr[] = []): UsersetExpr[] => {
  switch (expr.kind) {
    case 'union':
    case 'intersection':
      expr.children.forEach(c => positiveLeaves(c, out));
      break;
    case 'exclusion':
      positiveLeaves(expr.base, out);
      break;
    default:
      out.push(expr);
  }
  return out;
};

const buildIndex = (model: AuthorizationModel): ReverseIndex => {
  const index: ReverseIndex = { concrete: new Map(), wildcard: new Map(), userset: new Map(), computed: new Map(), tupleToUserset: new Map() };

  for (const ns of model.namespaces()) {
    const relations = ns.relations as Record<string, RelationDef>;
    for (const [relation, def] of Object.entries(relations)) {
      for (const s of def.subjects) {
        const parsed = parseSubjectType(s);
        const target = { namespace: ns.name, relation };
        if (parsed.wildcard) push(index.wildcard, parsed.namespace, target);
        else if (parsed.relation !== undefined) push(index.userset, `${parsed.namespace}.${parsed.relation}`, target);
        else push(index.concrete, parsed.namespace, target);
      }
    }

    for (const [permission, expr] of Object.entries(ns.permissions)) {
      for (const leaf of positiveLeaves(expr)) {
        if (leaf.kind === 'computed') {
          push(index.computed, `${ns.name}.${leaf.relation}`, permission);
        } else if (leaf.kind === 'tupleToUserset') {
          const walked = relations[leaf.tupleRelation];
          if (!walked) continue;
          const parents = new Set(
            walked.subjects
              .map(parseSubjectType)
              .filter(p => !p.wildcard && p.relation === undefined)
              .map(p => p.namespace),
          );
          for (const parent of parents) {
            push(index.tupleToUserset, `${parent}.${leaf.computedRelation}`, { namespace: ns.name, tupleRelation: leaf.tupleRelation, permission });
          }
        }
      }
    }
  }
  return index;
};

const reverseIndex = (model: AuthorizationModel): ReverseIndex => {
  let index = indexes.get(model);
  if (!index) {
    index = buildIndex(model);
    indexes.set(model, index);
  }
  return index;
};

interface Node {
  namespace: string;
  id: string;
  relation: string;
}

/**
 * Every object of `namespace` on which `subject` holds `permission`, following
 * userset rewrites. Zanzibar calls this lookup-resources.
 *
 * Unlike {@link PermissionsTupleRepository.listObjects}, which only reads direct
 * tuples, this expands `computed`, `tupleToUserset`, and userset subjects, so a
 * subject who reaches an object through a folder hierarchy or a group appears.
 *
 * It works in two steps. A breadth-first walk starts from the tuples that name
 * the subject and follows the model backwards (group to member relation, parent
 * to child, relation to the permissions built on it), which yields a superset of
 * the answer. Each concrete candidate is then confirmed with {@link checkDetailed},
 * so intersections and exclusions are applied exactly as `check` applies them.
 *
 * Cost is one `listObjects` call per reached `(object, relation)` pair that
 * something else builds on, plus one Check per candidate. Run it for listing
 * screens and background jobs, not on every request.
 *
 * @param model - Validated authorization model.
 * @param repo - Tuple store. Must implement the optional `listObjects`.
 * @param namespace - Namespace of the objects to list.
 * @param permission - Relation or permission on `namespace`.
 * @param subject - Concrete subject (`user:alice`) whose access is listed.
 * @param options - {@link CheckOptions.maxDepth} bounds both the walk and each Check;
 *   `sink` receives one observation per confirming Check.
 * @throws {PermissionsError} If `namespace` or `permission` is not declared on the model.
 * @throws {TypeError} If `subject` is not concrete, or `repo` does not implement `listObjects`.
 * @throws {RangeError} If `options.maxDepth` is not a positive integer.
 */
export const lookupObjects = async (
  model: AuthorizationModel,
  repo: PermissionsTupleRepository,
  namespace: string,
  permission: string,
  subject: SubjectRef,
  options: CheckOptions = {},
): Promise<LookupObjectsResult> => {
  model.resolve(namespace, permission);
  const maxDepth = resolveMaxDepth(options);
  if (subject.kind !== 'concrete') {
    throw new TypeError(`lookupObjects needs a concrete subject, got a ${subject.kind} subject`);
  }
  if (!repo.listObjects) {
    throw new TypeError('lookupObjects needs a repository that implements listObjects');
  }
  const listObjects = repo.listObjects.bind(repo);
  const index = reverseIndex(model);

  const reached = new Set<string>();
  const found: Node[] = [];
  let frontier: Node[] = [];
  const add = (node: Node, into: Node[]): void => {
    const key = `${node.namespace}:${node.id}.${node.relation}`;
    if (reached.has(key)) return;
    reached.add(key);
    into.push(node);
    if (node.namespace === namespace && node.relation === permission) found.push(node);
  };
  // A `*` row only counts on a relation that opted in, exactly as in Check.
  const addListed = (objects: ObjectRef[], walkedNamespace: string, walkedRelation: string, relation: string, into: Node[]): void => {
    for (const o of objects) {
      if (o.id === OBJECT_WILDCARD && !model.allowsObjectWildcard(walkedNamespace, walkedRelation)) continue;
      add({ namespace: o.namespace, id: o.id, relation }, into);
    }
  };

  for (const r of index.concrete.get(subject.namespace) ?? []) {
    addListed(await listObjects(r.namespace, r.relation, subject), r.namespace, r.relation, r.relation, frontier);
  }
  for (const r of index.wildcard.get(subject.namespace) ?? []) {
    addListed(
      await listObjects(r.namespace, r.relation, { kind: 'wildcard', namespace: subject.namespace }),
      r.namespace,
      r.relation,
      r.relation,
      frontier,
    );
  }

  let depth = 0;
  while (frontier.length > 0 && depth < maxDepth) {
    const next: Node[] = [];
    for (const node of frontier) {
      const key = `${node.namespace}.${node.relation}`;
      for (const p of index.computed.get(key) ?? []) add({ namespace: node.namespace, id: node.id, relation: p }, next);
      // No tuple names `ns:*` as its subject, so a `*` node has no further edges.
      if (node.id === OBJECT_WILDCARD) continue;

      for (const r of index.userset.get(key) ?? []) {
        const objects = await listObjects(r.namespace, r.relation, {
          kind: 'userset',
          namespace: node.namespace,
          id: node.id,
          relation: node.relation,
        });
        addListed(objects, r.namespace, r.relation, r.relation, next);
      }
      for (const edge of index.tupleToUserset.get(key) ?? []) {
        const objects = await listObjects(edge.namespace, edge.tupleRelation, { kind: 'concrete', namespace: node.namespace, id: node.id });
        addListed(objects, edge.namespace, edge.tupleRelation, edge.permission, next);
      }
    }
    frontier = next;
    depth++;
  }

  // Stopping with an unexpanded frontier only loses answers if the frontier still has edges to follow.
  const hasEdges = (node: Node): boolean => {
    const key = `${node.namespace}.${node.relation}`;
    if (index.computed.has(key)) return true;
    return node.id !== OBJECT_WILDCARD && (index.userset.has(key) || index.tupleToUserset.has(key));
  };
  let maxDepthExceeded = frontier.some(hasEdges);
  let everyObject = false;
  const objects: ObjectRef[] = [];
  let candidates = 0;
  for (const node of found) {
    if (node.id === OBJECT_WILDCARD) {
      everyObject = true;
      continue;
    }
    candidates++;
    const object = { namespace: node.namespace, id: node.id };
    const result = await checkDetailed(model, repo, object, permission, subject, { maxDepth, sink: options.sink });
    if (result.maxDepthExceeded) maxDepthExceeded = true;
    if (result.allowed) objects.push(object);
  }

  return { objects, everyObject, maxDepthExceeded, candidates };
};
