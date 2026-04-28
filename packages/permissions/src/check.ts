import type { AuthorizationModel, UsersetExpr } from './dsl.js';
import type { PermissionsTupleRepository } from './tuples.repository.js';
import type { ObjectRef, SubjectRef } from './tuple.js';
import { type CheckMetrics, type CheckMetricsSink, newCheckMetrics, noopMetricsSink } from './check.metrics.js';

const MAX_DEPTH = 32;

interface CheckCtx {
    model: AuthorizationModel;
    repo: PermissionsTupleRepository;
    memo: Map<string, boolean>; // per-request cache
    visiting: Set<string>; // cycle guard
    metrics: CheckMetrics;
}

const formatSubject = (s: SubjectRef): string => {
    switch (s.kind) {
        case 'concrete':
            return `${s.namespace}:${s.id}`;
        case 'wildcard':
            return `${s.namespace}:*`;
        case 'userset':
            return `${s.namespace}:${s.id}#${s.relation}`;
    }
};

const memoKey = (object: ObjectRef, relation: string, subject: SubjectRef): string =>
    `${object.namespace}:${object.id}#${relation}@${formatSubject(subject)}`;

/**
 * Evaluate whether `subject` satisfies `relationOrPermission` on `object`
 * under the given {@link AuthorizationModel}. Implements the Zanzibar Check
 * algorithm: walks userset rewrites, recurses through `tupleToUserset`
 * parents, and short-circuits on the first allow.
 *
 * Each call gets a fresh per-request memo and cycle guard. Recursion is
 * capped at a fixed `MAX_DEPTH` (32) — exceeding it returns `false` and
 * sets {@link CheckMetrics.hitMaxDepth}.
 *
 * @param model - Validated authorization model.
 * @param repo - Storage backend for relation tuples.
 * @param object - Object the access question is about.
 * @param relationOrPermission - Relation or permission name on
 *   `object.namespace`.
 * @param subject - Subject whose access is being checked.
 * @param sink - Optional telemetry sink; defaults to {@link noopMetricsSink}.
 * @returns `true` if access is granted, `false` otherwise.
 * @throws {Error} If `object.namespace` or `relationOrPermission` is not
 *   declared on the model.
 */
export const check = async (
    model: AuthorizationModel,
    repo: PermissionsTupleRepository,
    object: ObjectRef,
    relationOrPermission: string,
    subject: SubjectRef,
    sink: CheckMetricsSink = noopMetricsSink,
): Promise<boolean> => {
    const ctx: CheckCtx = {
        model,
        repo,
        memo: new Map(),
        visiting: new Set(),
        metrics: newCheckMetrics(),
    };
    const start = performance.now();
    const allowed = await checkInner(ctx, object, relationOrPermission, subject, 0);
    ctx.metrics.durationMs = performance.now() - start;
    sink.record(ctx.metrics, {
        namespace: object.namespace,
        permission: relationOrPermission,
        allowed,
    });
    return allowed;
};

const checkInner = async (
    ctx: CheckCtx,
    object: ObjectRef,
    relOrPerm: string,
    subject: SubjectRef,
    depth: number,
): Promise<boolean> => {
    if (depth > ctx.metrics.maxDepth) ctx.metrics.maxDepth = depth;
    if (depth > MAX_DEPTH) {
        ctx.metrics.hitMaxDepth = true;
        return false;
    }

    const key = memoKey(object, relOrPerm, subject);
    const cached = ctx.memo.get(key);
    if (cached !== undefined) {
        ctx.metrics.cacheHits++;
        return cached;
    }
    if (ctx.visiting.has(key)) return false;
    ctx.visiting.add(key);

    let result: boolean;
    try {
        const expr = ctx.model.resolve(object.namespace, relOrPerm);
        result = await evaluate(ctx, object, relOrPerm, expr, subject, depth);
    } finally {
        ctx.visiting.delete(key);
    }
    ctx.memo.set(key, result);
    return result;
};

const evaluate = async (
    ctx: CheckCtx,
    object: ObjectRef,
    relation: string,
    expr: UsersetExpr,
    subject: SubjectRef,
    depth: number,
): Promise<boolean> => {
    switch (expr.kind) {
        case 'direct':
            return hasDirectTuple(ctx, object, relation, subject, depth);

        case 'computed':
            return checkInner(ctx, object, expr.relation, subject, depth + 1);

        case 'tupleToUserset': {
            ctx.metrics.parentLookups++;
            const parents = await ctx.repo.listObjectsRelatedBy(object.namespace, object.id, expr.tupleRelation);
            for (const p of parents) {
                if (await checkInner(ctx, p, expr.computedRelation, subject, depth + 1)) return true;
            }
            return false;
        }

        case 'union':
            for (const c of expr.children) {
                if (await evaluate(ctx, object, relation, c, subject, depth)) return true;
            }
            return false;

        case 'intersection':
            for (const c of expr.children) {
                if (!(await evaluate(ctx, object, relation, c, subject, depth))) return false;
            }
            return true;

        case 'exclusion':
            return (
                (await evaluate(ctx, object, relation, expr.base, subject, depth)) &&
                !(await evaluate(ctx, object, relation, expr.subtract, subject, depth))
            );
    }
};

const hasDirectTuple = async (
    ctx: CheckCtx,
    object: ObjectRef,
    relation: string,
    subject: SubjectRef,
    depth: number,
): Promise<boolean> => {
    ctx.metrics.tupleReads++;
    const stored = await ctx.repo.listByObjectRelation(object.namespace, object.id, relation);

    for (const t of stored) {
        // 1) exact match on a concrete subject
        if (
            subject.kind === 'concrete' &&
            t.subject.kind === 'concrete' &&
            t.subject.namespace === subject.namespace &&
            t.subject.id === subject.id
        ) {
            return true;
        }

        // 2) wildcard tuple grants any concrete subject of that namespace
        if (
            t.subject.kind === 'wildcard' &&
            subject.kind === 'concrete' &&
            t.subject.namespace === subject.namespace
        ) {
            return true;
        }

        // 3) userset subject — recurse: does `subject` satisfy `t.subject.relation`
        // on the userset's object?
        if (t.subject.kind === 'userset') {
            const parentObj: ObjectRef = { namespace: t.subject.namespace, id: t.subject.id };
            if (await checkInner(ctx, parentObj, t.subject.relation, subject, depth + 1)) return true;
        }
    }
    return false;
};

/**
 * Internal hook exposing module-private constants to tests. Not part of the
 * public API — use only for assertions about the Check evaluator's bounds.
 */
export const __testing = { MAX_DEPTH };
