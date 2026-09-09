import { PermissionsError } from './errors.js';
import { formatSubject, type RelationTuple, type SubjectRef } from './tuple.js';
/**
 * Userset expression tree. Mirrors the Zanzibar paper's userset rewrite
 * primitives.
 *
 * `direct` is what the paper calls `_this_` — kept as `direct` here to avoid
 * colliding with the TypeScript `this` keyword. The remaining variants
 * correspond to `computed_userset`, `tuple_to_userset`, and the set-algebra
 * combinators (`union`, `intersection`, `exclusion`).
 */
export type UsersetExpr =
  | { kind: 'direct' }
  | { kind: 'computed'; relation: string }
  | { kind: 'tupleToUserset'; tupleRelation: string; computedRelation: string }
  | { kind: 'union'; children: UsersetExpr[] }
  | { kind: 'intersection'; children: UsersetExpr[] }
  | { kind: 'exclusion'; base: UsersetExpr; subtract: UsersetExpr };

/**
 * Userset expression that resolves through directly stored tuples on the
 * relation being evaluated. Equivalent to Zanzibar's `_this_`.
 */
export const direct = (): UsersetExpr => ({ kind: 'direct' });

/**
 * Userset expression that delegates to another relation/permission on the
 * same object. Equivalent to Zanzibar's `computed_userset`.
 *
 * @param relation - Name of the relation or permission on the same namespace.
 */
export const computed = (relation: string): UsersetExpr => ({ kind: 'computed', relation });

/**
 * Userset expression that walks a tuple edge and then evaluates a relation on
 * the parent. Equivalent to Zanzibar's `tuple_to_userset`.
 *
 * @param tupleRelation - Relation on the current object that points at parent
 *   objects (e.g. `parent`, `owner`).
 * @param computedRelation - Relation/permission to evaluate on each parent.
 */
export const tupleToUserset = (tupleRelation: string, computedRelation: string): UsersetExpr => ({
  kind: 'tupleToUserset',
  tupleRelation,
  computedRelation,
});

/**
 * Logical OR over child expressions. Evaluates left-to-right and short-circuits
 * on the first allow.
 *
 * @param children - Child expressions; at least one is required.
 */
export const union = (...children: UsersetExpr[]): UsersetExpr => ({ kind: 'union', children });

/**
 * Logical AND over child expressions. Evaluates left-to-right and short-circuits
 * on the first deny.
 *
 * @param children - Child expressions; at least one is required.
 */
export const intersection = (...children: UsersetExpr[]): UsersetExpr => ({ kind: 'intersection', children });

/**
 * Set difference: subjects allowed by `base` but not by `subtract`.
 *
 * @param base - Expression that grants access.
 * @param subtract - Expression whose matches are removed from `base`.
 */
export const exclusion = (base: UsersetExpr, subtract: UsersetExpr): UsersetExpr => ({ kind: 'exclusion', base, subtract });

/**
 * Allowed subject types for a relation. Encoded as strings:
 *
 * - `<namespace>` — concrete subjects of that namespace, e.g. `user`.
 * - `<namespace>.*` — wildcard subject of that namespace allowed.
 * - `<namespace>.<relation>` — userset subject (e.g. `org.admin`).
 */
export type SubjectType = string;

/**
 * Definition of a single relation on a namespace.
 */
export interface RelationDef {
  /**
   * Allowed subject types for *direct* tuples on this relation. Enforced at
   * write time (when persisting tuples), not at Check time.
   */
  subjects: SubjectType[];
}

/**
 * Definition of a single namespace: its relations (which carry stored tuples)
 * and its permissions (which evaluate userset expressions over those relations).
 *
 * @typeParam R - String literal union of relation names on this namespace.
 * @typeParam P - String literal union of permission names on this namespace.
 */
export interface NamespaceDef<R extends string = string, P extends string = string> {
  name: string;
  relations: Record<R, RelationDef>;
  permissions: Record<P, UsersetExpr>;
}

/**
 * Builds a {@link NamespaceDef} with literal-typed relation and permission
 * names so downstream code can type-check the names it references.
 *
 * @param name - Namespace name (must match `/^[a-z][a-z0-9_]*$/`).
 * @param def - Relations and permissions for the namespace.
 */
export const defineNamespace = <R extends string, P extends string>(
  name: string,
  def: { relations: Record<R, RelationDef>; permissions: Record<P, UsersetExpr> },
): NamespaceDef<R, P> => ({ name, ...def });

const NAMESPACE_PATTERN = /^[a-z][a-z0-9_]*$/;
const RELATION_PATTERN = /^[a-z][a-z0-9_]*$/;

const parseSubjectType = (s: SubjectType): { namespace: string; relation?: string; wildcard: boolean } => {
  if (s.endsWith('.*')) {
    return { namespace: s.slice(0, -2), wildcard: true };
  }
  const dot = s.indexOf('.');
  if (dot !== -1) {
    return { namespace: s.slice(0, dot), relation: s.slice(dot + 1), wildcard: false };
  }
  return { namespace: s, wildcard: false };
};

/**
 * Validated collection of {@link NamespaceDef} entries that backs the
 * Check evaluator. Construction validates name shapes and cross-references
 * (subject namespaces, computed relations, tupleToUserset walks) so a bad
 * model fails at startup rather than at Check time.
 */
export class AuthorizationModel {
  private readonly byName = new Map<string, NamespaceDef>();

  /**
   * @param namespaces - Namespace definitions; names must be unique.
   * @throws {Error} If a name is malformed, duplicated, or references an
   *   unknown namespace/relation.
   */
  constructor(namespaces: NamespaceDef[]) {
    for (const ns of namespaces) {
      if (this.byName.has(ns.name)) {
        throw new Error(`duplicate namespace: ${ns.name}`);
      }
      this.byName.set(ns.name, ns);
    }
    this.validate();
  }

  /**
   * All registered namespaces, in insertion order.
   */
  namespaces(): NamespaceDef[] {
    return [...this.byName.values()];
  }

  /**
   * Look up a namespace by name. Returns `undefined` for unknown names.
   */
  get(name: string): NamespaceDef | undefined {
    return this.byName.get(name);
  }

  /**
   * Resolve `namespace.name` to the userset expression to evaluate.
   *
   * Plain relations have implicit `direct` semantics — they carry stored
   * tuples but no rewrite. Permissions delegate to their declared expression.
   *
   * @throws {Error} If the namespace or relation/permission is unknown.
   */
  resolve(namespace: string, name: string): UsersetExpr {
    const ns = this.byName.get(namespace);
    if (!ns) throw new PermissionsError('unknown_namespace', `unknown namespace: ${namespace}`, { namespace });
    if (name in ns.permissions) {
      return ns.permissions[name as keyof typeof ns.permissions]!;
    }
    if (name in ns.relations) return direct();
    throw new PermissionsError('unknown_relation', `unknown relation/permission: ${namespace}.${name}`, { namespace, relation: name });
  }

  /**
   * Whether `subject` is an allowed subject type for `namespace.relation`,
   * according to the relation's declared `subjects`.
   *
   * `RelationDef.subjects` is a write-time contract: {@link check} reads whatever
   * tuples the store returns and does not re-check them, so a relation
   * deliberately declared without `user.*` is still world-grantable unless
   * something validates on the way in. That is what this answers, and what
   * {@link ModelValidatingTupleRepository} enforces.
   *
   * @param namespace - Object namespace the tuple is written against.
   * @param relation - Relation on that namespace.
   * @param subject - Subject of the tuple.
   * @returns `true` when the relation declares a matching subject type.
   * @throws {PermissionsError} When the namespace or relation is unknown.
   */
  isSubjectAllowed(namespace: string, relation: string, subject: SubjectRef): boolean {
    const ns = this.byName.get(namespace);
    if (!ns) throw new PermissionsError('unknown_namespace', `unknown namespace: ${namespace}`, { namespace });
    const def = (ns.relations as Record<string, RelationDef | undefined>)[relation];
    if (!def) {
      throw new PermissionsError('unknown_relation', `unknown relation: ${namespace}.${relation}`, { namespace, relation });
    }

    return def.subjects.some(declared => {
      const parsed = parseSubjectType(declared);
      if (subject.kind === 'wildcard') return parsed.wildcard && parsed.namespace === subject.namespace;
      if (subject.kind === 'userset') return parsed.relation === subject.relation && parsed.namespace === subject.namespace;
      // A concrete subject matches a bare `<namespace>` declaration. It does not
      // match `<namespace>.*`, which declares that the wildcard subject itself is
      // grantable, nor a userset declaration.
      return !parsed.wildcard && parsed.relation === undefined && parsed.namespace === subject.namespace;
    });
  }

  /**
   * Assert that every tuple names a subject type its relation declares.
   *
   * @param tuples - Tuples about to be written.
   * @throws {PermissionsError} `subject_not_allowed` on the first tuple that fails,
   *   or `unknown_namespace` / `unknown_relation` when a tuple names something the
   *   model does not define.
   */
  assertTuplesAllowed(tuples: readonly RelationTuple[]): void {
    for (const tuple of tuples) {
      if (this.isSubjectAllowed(tuple.object.namespace, tuple.relation, tuple.subject)) continue;
      throw new PermissionsError(
        'subject_not_allowed',
        `${tuple.object.namespace}.${tuple.relation} does not allow subject ${formatSubject(tuple.subject)}`,
        { namespace: tuple.object.namespace, relation: tuple.relation },
      );
    }
  }

  private validate(): void {
    for (const ns of this.byName.values()) {
      if (!NAMESPACE_PATTERN.test(ns.name)) {
        throw new Error(`namespace name must match ${NAMESPACE_PATTERN}: '${ns.name}'`);
      }
      this.validateRelations(ns);
      this.validatePermissions(ns);
    }
  }

  private validateRelations(ns: NamespaceDef): void {
    for (const [rel, def] of Object.entries(ns.relations)) {
      if (!RELATION_PATTERN.test(rel)) {
        throw new Error(`${ns.name}: relation name must match ${RELATION_PATTERN}: '${rel}'`);
      }
      for (const s of def.subjects) {
        this.validateSubjectType(ns.name, rel, s);
      }
    }
  }

  private validateSubjectType(ns: string, rel: string, s: SubjectType): void {
    const { namespace, relation } = parseSubjectType(s);
    if (!NAMESPACE_PATTERN.test(namespace)) {
      throw new Error(`${ns}.${rel}: malformed subject type '${s}'`);
    }
    const target = this.byName.get(namespace);
    if (!target) {
      throw new Error(`${ns}.${rel}: unknown subject namespace '${namespace}'`);
    }
    if (relation !== undefined && !(relation in target.relations)) {
      throw new Error(`${ns}.${rel}: unknown subject relation '${namespace}.${relation}'`);
    }
  }

  private validatePermissions(ns: NamespaceDef): void {
    for (const [perm, expr] of Object.entries(ns.permissions)) {
      if (!RELATION_PATTERN.test(perm)) {
        throw new Error(`${ns.name}: permission name must match ${RELATION_PATTERN}: '${perm}'`);
      }
      if (perm in ns.relations) {
        throw new Error(`${ns.name}: '${perm}' is declared as both a relation and a permission`);
      }
      this.validateExpr(ns, perm, expr);
    }
  }

  private validateExpr(ns: NamespaceDef, where: string, expr: UsersetExpr): void {
    switch (expr.kind) {
      case 'direct':
        return;
      case 'computed': {
        if (!(expr.relation in ns.relations) && !(expr.relation in ns.permissions)) {
          throw new Error(`${ns.name}.${where}: computed references unknown '${expr.relation}'`);
        }
        return;
      }
      case 'tupleToUserset': {
        const tupleRel = ns.relations[expr.tupleRelation];
        if (!tupleRel) {
          throw new Error(`${ns.name}.${where}: tupleToUserset walks unknown tuple relation '${expr.tupleRelation}'`);
        }
        // `expr.computedRelation` must exist on at least one of the namespaces
        // the tuple relation accepts as a subject — otherwise the walk can never
        // resolve. We don't require it on *all* of them: a relation like
        // `owner: [user, org.admin]` legitimately mixes subject namespaces, and
        // the evaluator skips ones that can't satisfy the computedRelation.
        const candidateNamespaces = new Set<string>();
        for (const s of tupleRel.subjects) {
          const parsed = parseSubjectType(s);
          if (parsed.relation === undefined) candidateNamespaces.add(parsed.namespace);
        }
        let resolved = false;
        for (const candidate of candidateNamespaces) {
          const target = this.byName.get(candidate);
          if (!target) continue;
          if (expr.computedRelation in target.relations || expr.computedRelation in target.permissions) {
            resolved = true;
            break;
          }
        }
        if (!resolved) {
          throw new Error(
            `${ns.name}.${where}: tupleToUserset references '${expr.computedRelation}' which is not defined on any subject namespace of '${expr.tupleRelation}'`,
          );
        }
        return;
      }
      case 'union':
      case 'intersection':
        if (expr.children.length === 0) {
          throw new Error(`${ns.name}.${where}: ${expr.kind} requires at least one child`);
        }
        expr.children.forEach(c => this.validateExpr(ns, where, c));
        return;
      case 'exclusion':
        this.validateExpr(ns, where, expr.base);
        this.validateExpr(ns, where, expr.subtract);
        return;
    }
  }
}
