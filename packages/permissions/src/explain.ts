import type { AuthorizationModel, UsersetExpr } from './dsl.js';
import { type ObjectRef, type RelationTuple, type SubjectRef, formatSubject } from './tuple.js';
import type { PermissionsTupleRepository } from './tuples.repository.js';

const MAX_DEPTH = 32;

/**
 * Hierarchical result of evaluating a permission check — one node per step
 * the evaluator took. Mirrors the branches of {@link UsersetExpr} plus the
 * meta nodes (`cycle`, `maxDepth`, `cached`) the runtime can hit.
 *
 * Every node carries an `allowed` flag and an `expr` label describing where
 * in the schema the step lives ("union", "tupleToUserset parent->viewer", …).
 * Consumers (CLI `--explain`, the VSCode playground) walk this tree to
 * render a debuggable trace.
 */
export type CheckTrace =
    | DirectTrace
    | ComputedTrace
    | TupleToUsersetTrace
    | UnionTrace
    | IntersectionTrace
    | ExclusionTrace
    | CycleTrace
    | MaxDepthTrace
    | CachedTrace;

/** Trace node for an evaluator step that reads stored tuples directly. */
export interface DirectTrace {
    kind: 'direct';
    object: ObjectRef;
    relation: string;
    subject: SubjectRef;
    /** Tuples loaded from the repository for this `(object, relation)` pair. */
    tuplesExamined: RelationTuple[];
    /** The tuple that satisfied the check, if any. */
    matched?: RelationTuple;
    /**
     * If the matched tuple is a userset subject, the recursive trace into
     * that userset (so the caller can see *why* the indirect grant fired).
     */
    usersetChild?: CheckTrace;
    allowed: boolean;
}

/** Trace node for a `computed_userset` rewrite — delegation to another relation/permission on the same object. */
export interface ComputedTrace {
    kind: 'computed';
    relation: string;
    child: CheckTrace;
    allowed: boolean;
}

/** Trace node for a `tuple_to_userset` walk through one or more parent objects. */
export interface TupleToUsersetTrace {
    kind: 'tupleToUserset';
    tupleRelation: string;
    computedRelation: string;
    /** One trace per parent object discovered via `tupleRelation`. */
    parents: Array<{ parent: ObjectRef; trace: CheckTrace }>;
    allowed: boolean;
}

/** Trace node for a union (logical OR) — `allowed` is true if any child allows. */
export interface UnionTrace {
    kind: 'union';
    children: CheckTrace[];
    allowed: boolean;
}

/** Trace node for an intersection (logical AND) — `allowed` is true only if every child allows. */
export interface IntersectionTrace {
    kind: 'intersection';
    children: CheckTrace[];
    allowed: boolean;
}

/** Trace node for a set-difference (`base` minus `subtract`). */
export interface ExclusionTrace {
    kind: 'exclusion';
    base: CheckTrace;
    subtract: CheckTrace;
    allowed: boolean;
}

/** Trace node emitted when the evaluator re-entered an in-flight `(object, relation, subject)` triple. */
export interface CycleTrace {
    kind: 'cycle';
    key: string;
    allowed: false;
}

/** Trace node emitted when recursion exceeded the evaluator's hard depth cap. */
export interface MaxDepthTrace {
    kind: 'maxDepth';
    depth: number;
    allowed: false;
}

/** Trace node emitted when the result was served from the per-request memo. */
export interface CachedTrace {
    kind: 'cached';
    key: string;
    allowed: boolean;
}

/** Top-level result returned by {@link explain}. */
export interface ExplainResult {
    object: ObjectRef;
    relation: string;
    subject: SubjectRef;
    allowed: boolean;
    trace: CheckTrace;
}

interface ExplainCtx {
    model: AuthorizationModel;
    repo: PermissionsTupleRepository;
    memo: Map<string, boolean>;
    visiting: Set<string>;
}

const memoKey = (object: ObjectRef, relation: string, subject: SubjectRef): string =>
    `${object.namespace}:${object.id}.${relation}@${formatSubject(subject)}`;

/**
 * Trace a permission check and return the full decision tree without
 * short-circuiting child evaluation — every union/intersection branch is
 * evaluated so the resulting trace is debuggable, even at the cost of doing
 * more work than the production {@link check} function. The top-level
 * `allowed` still uses standard Zanzibar semantics.
 *
 * Use this from CLIs (`pdsl explain`), the VSCode playground, or any
 * tooling that needs to surface *why* a permission decision came out the
 * way it did. Do not use on a hot request path — call {@link check} there.
 */
export const explain = async (
    model: AuthorizationModel,
    repo: PermissionsTupleRepository,
    object: ObjectRef,
    relationOrPermission: string,
    subject: SubjectRef,
): Promise<ExplainResult> => {
    const ctx: ExplainCtx = { model, repo, memo: new Map(), visiting: new Set() };
    const trace = await traceCheck(ctx, object, relationOrPermission, subject, 0);
    return { object, relation: relationOrPermission, subject, allowed: trace.allowed, trace };
};

const traceCheck = async (
    ctx: ExplainCtx,
    object: ObjectRef,
    relOrPerm: string,
    subject: SubjectRef,
    depth: number,
): Promise<CheckTrace> => {
    if (depth > MAX_DEPTH) return { kind: 'maxDepth', depth, allowed: false };

    const key = memoKey(object, relOrPerm, subject);
    const cached = ctx.memo.get(key);
    if (cached !== undefined) return { kind: 'cached', key, allowed: cached };
    if (ctx.visiting.has(key)) return { kind: 'cycle', key, allowed: false };

    ctx.visiting.add(key);
    let trace: CheckTrace;
    try {
        const expr = ctx.model.resolve(object.namespace, relOrPerm);
        trace = await traceExpr(ctx, object, relOrPerm, expr, subject, depth);
    } finally {
        ctx.visiting.delete(key);
    }
    ctx.memo.set(key, trace.allowed);
    return trace;
};

const traceExpr = async (
    ctx: ExplainCtx,
    object: ObjectRef,
    relation: string,
    expr: UsersetExpr,
    subject: SubjectRef,
    depth: number,
): Promise<CheckTrace> => {
    switch (expr.kind) {
        case 'direct':
            return traceDirect(ctx, object, relation, subject, depth);

        case 'computed': {
            const child = await traceCheck(ctx, object, expr.relation, subject, depth + 1);
            return { kind: 'computed', relation: expr.relation, child, allowed: child.allowed };
        }

        case 'tupleToUserset': {
            const parents = await ctx.repo.listObjectsRelatedBy(object.namespace, object.id, expr.tupleRelation);
            const results: Array<{ parent: ObjectRef; trace: CheckTrace }> = [];
            for (const p of parents) {
                const t = await traceCheck(ctx, p, expr.computedRelation, subject, depth + 1);
                results.push({ parent: p, trace: t });
            }
            return {
                kind: 'tupleToUserset',
                tupleRelation: expr.tupleRelation,
                computedRelation: expr.computedRelation,
                parents: results,
                allowed: results.some(r => r.trace.allowed),
            };
        }

        case 'union': {
            const children: CheckTrace[] = [];
            for (const c of expr.children) children.push(await traceExpr(ctx, object, relation, c, subject, depth));
            return { kind: 'union', children, allowed: children.some(c => c.allowed) };
        }

        case 'intersection': {
            const children: CheckTrace[] = [];
            for (const c of expr.children) children.push(await traceExpr(ctx, object, relation, c, subject, depth));
            return { kind: 'intersection', children, allowed: children.every(c => c.allowed) };
        }

        case 'exclusion': {
            const base = await traceExpr(ctx, object, relation, expr.base, subject, depth);
            const subtract = await traceExpr(ctx, object, relation, expr.subtract, subject, depth);
            return { kind: 'exclusion', base, subtract, allowed: base.allowed && !subtract.allowed };
        }
    }
};

const traceDirect = async (
    ctx: ExplainCtx,
    object: ObjectRef,
    relation: string,
    subject: SubjectRef,
    depth: number,
): Promise<DirectTrace> => {
    const stored = await ctx.repo.listByObjectRelation(object.namespace, object.id, relation);
    let matched: RelationTuple | undefined;
    let usersetChild: CheckTrace | undefined;
    let allowed = false;

    for (const t of stored) {
        if (
            subject.kind === 'concrete' &&
            t.subject.kind === 'concrete' &&
            t.subject.namespace === subject.namespace &&
            t.subject.id === subject.id
        ) {
            matched = t;
            allowed = true;
            break;
        }
        if (t.subject.kind === 'wildcard' && subject.kind === 'concrete' && t.subject.namespace === subject.namespace) {
            matched = t;
            allowed = true;
            break;
        }
        if (t.subject.kind === 'userset') {
            const parent: ObjectRef = { namespace: t.subject.namespace, id: t.subject.id };
            const child = await traceCheck(ctx, parent, t.subject.relation, subject, depth + 1);
            if (child.allowed) {
                matched = t;
                usersetChild = child;
                allowed = true;
                break;
            }
        }
    }

    return {
        kind: 'direct',
        object,
        relation,
        subject,
        tuplesExamined: stored,
        matched,
        usersetChild,
        allowed,
    };
};

/**
 * Render a {@link CheckTrace} as an indented multi-line string. Used by the
 * CLI's `--explain` flag and as the default rendering for hover / log output.
 */
export const formatTrace = (trace: CheckTrace, indent = 0): string => {
    const pad = '  '.repeat(indent);
    const mark = trace.allowed ? '✓' : '✗';
    switch (trace.kind) {
        case 'direct': {
            const head = `${pad}${mark} direct ${trace.object.namespace}:${trace.object.id}.${trace.relation} (${trace.tuplesExamined.length} tuple${trace.tuplesExamined.length === 1 ? '' : 's'})`;
            if (trace.matched && trace.usersetChild) {
                return `${head}\n${pad}  via ${formatSubject(trace.matched.subject)}\n${formatTrace(trace.usersetChild, indent + 2)}`;
            }
            if (trace.matched) {
                return `${head}\n${pad}  via ${formatSubject(trace.matched.subject)}`;
            }
            return head;
        }
        case 'computed':
            return `${pad}${mark} computed → ${trace.relation}\n${formatTrace(trace.child, indent + 1)}`;
        case 'tupleToUserset': {
            const head = `${pad}${mark} ${trace.tupleRelation}->${trace.computedRelation} (${trace.parents.length} parent${trace.parents.length === 1 ? '' : 's'})`;
            if (trace.parents.length === 0) return head;
            return `${head}\n${trace.parents.map(p => `${pad}  via ${p.parent.namespace}:${p.parent.id}\n${formatTrace(p.trace, indent + 2)}`).join('\n')}`;
        }
        case 'union':
            return `${pad}${mark} union\n${trace.children.map(c => formatTrace(c, indent + 1)).join('\n')}`;
        case 'intersection':
            return `${pad}${mark} intersection\n${trace.children.map(c => formatTrace(c, indent + 1)).join('\n')}`;
        case 'exclusion':
            return `${pad}${mark} exclusion\n${pad}  base:\n${formatTrace(trace.base, indent + 2)}\n${pad}  subtract:\n${formatTrace(trace.subtract, indent + 2)}`;
        case 'cycle':
            return `${pad}✗ cycle at ${trace.key}`;
        case 'maxDepth':
            return `${pad}✗ max depth (${trace.depth}) exceeded`;
        case 'cached':
            return `${pad}${mark} cached ${trace.key}`;
    }
};
