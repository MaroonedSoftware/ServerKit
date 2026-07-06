import {
    AuthorizationModel,
    computed,
    defineNamespace,
    exclusion,
    intersection,
    tupleToUserset,
    union,
    type NamespaceDef,
    type SubjectType,
    type UsersetExpr,
} from '@maroonedsoftware/permissions';
import type { ExprNode, FileNode, NamespaceNode, PermissionNode, RelationNode, SourceSpan, SubjectTypeNode } from './ast.js';
import { CompileError } from './diagnostics.js';

/** Input to {@link lower}. `source` and `filename` are used for diagnostic context. */
export interface LowerOptions {
    source: string;
    filename?: string;
}

/**
 * Result of {@link lower} — the parsed namespaces translated to
 * `@maroonedsoftware/permissions` builder calls, plus a validated
 * `AuthorizationModel` constructed from them.
 */
export interface LowerResult {
    namespaces: NamespaceDef[];
    model: AuthorizationModel;
}

const subjectToString = (s: SubjectTypeNode): SubjectType => {
    if (s.relation !== undefined) return `${s.namespace}.${s.relation}`;
    if (s.wildcard) return `${s.namespace}.*`;
    return s.namespace;
};

const lowerExpr = (node: ExprNode): UsersetExpr => {
    switch (node.kind) {
        case 'ref':
            return computed(node.name);
        case 'ttu':
            return tupleToUserset(node.tupleRelation, node.computedRelation);
        case 'union':
            return union(...node.children.map(lowerExpr));
        case 'intersection':
            return intersection(...node.children.map(lowerExpr));
        case 'exclusion':
            return exclusion(lowerExpr(node.base), lowerExpr(node.subtract));
    }
};

// Resolves `ref('X')` to `direct()` when X *is the same relation* being defined
// (so `permission view = view` would be ill-formed, but a relation-as-permission
// reference resolves correctly via the model). This pass is a no-op for now —
// ContextModel.resolve() handles the implicit `direct` for relations at check time.
const lowerNamespace = (ns: NamespaceNode): NamespaceDef => {
    const relations: Record<string, { subjects: SubjectType[] }> = {};
    const permissions: Record<string, UsersetExpr> = {};
    for (const m of ns.members) {
        if (m.kind === 'relation') {
            relations[m.name] = { subjects: m.subjects.map(subjectToString) };
        } else {
            permissions[m.name] = lowerExpr(m.expr);
        }
    }
    return defineNamespace(ns.name, { relations, permissions });
};

const NAME_RE = /^[a-z][a-z0-9_]*$/;

function fail(opts: LowerOptions, span: SourceSpan, message: string): never {
    throw new CompileError({ source: opts.source, filename: opts.filename, span, message });
}

const validateLocal = (opts: LowerOptions, file: FileNode): void => {
    const seenNs = new Map<string, NamespaceNode>();
    for (const ns of file.namespaces) {
        if (!NAME_RE.test(ns.name)) {
            fail(opts, ns.nameLoc, `namespace name must match ${NAME_RE}: '${ns.name}'`);
        }
        const prior = seenNs.get(ns.name);
        if (prior) fail(opts, ns.nameLoc, `duplicate namespace: '${ns.name}'`);
        seenNs.set(ns.name, ns);

        const relations = new Map<string, RelationNode>();
        const permissions = new Map<string, PermissionNode>();
        for (const m of ns.members) {
            if (!NAME_RE.test(m.name)) {
                fail(opts, m.nameLoc, `${m.kind} name must match ${NAME_RE}: '${m.name}'`);
            }
            if (m.kind === 'relation') {
                if (relations.has(m.name)) fail(opts, m.nameLoc, `${ns.name}: duplicate relation '${m.name}'`);
                if (permissions.has(m.name)) {
                    fail(opts, m.nameLoc, `${ns.name}: '${m.name}' is declared as both a relation and a permission`);
                }
                relations.set(m.name, m);
            } else {
                if (permissions.has(m.name)) fail(opts, m.nameLoc, `${ns.name}: duplicate permission '${m.name}'`);
                if (relations.has(m.name)) {
                    fail(opts, m.nameLoc, `${ns.name}: '${m.name}' is declared as both a relation and a permission`);
                }
                permissions.set(m.name, m);
            }
        }
    }
};

/** Shared context for the reference-validation pass: diagnostic options plus the namespace lookup table. */
interface RefScope {
    opts: LowerOptions;
    nsByName: Map<string, NamespaceNode>;
}

/** A `ref` resolves only if the name is a declared relation or permission in the same namespace. */
const checkRefExpr = (scope: RefScope, ns: NamespaceNode, where: PermissionNode, expr: Extract<ExprNode, { kind: 'ref' }>): void => {
    const declared = ns.members.some(m => m.name === expr.name);
    if (!declared) {
        fail(scope.opts, expr.loc, `${ns.name}.${where.name}: reference to unknown '${expr.name}'`);
    }
};

/** A `tupleToUserset` needs its tuple relation to exist and its computed relation to live on some walkable subject namespace. */
const checkTtuExpr = (scope: RefScope, ns: NamespaceNode, where: PermissionNode, expr: Extract<ExprNode, { kind: 'ttu' }>): void => {
    const tupRel = ns.members.find((m): m is RelationNode => m.kind === 'relation' && m.name === expr.tupleRelation);
    if (!tupRel) {
        fail(scope.opts, expr.loc, `${ns.name}.${where.name}: tupleToUserset walks unknown tuple relation '${expr.tupleRelation}'`);
    }
    // computedRelation must exist on at least one subject namespace of tupleRelation.
    const resolved = tupRel.subjects.some(s => {
        if (s.relation !== undefined) return false; // userset subjects don't define namespaces to walk
        const target = scope.nsByName.get(s.namespace);
        return target?.members.some(m => m.name === expr.computedRelation) ?? false;
    });
    if (!resolved) {
        fail(
            scope.opts,
            expr.loc,
            `${ns.name}.${where.name}: tupleToUserset references '${expr.computedRelation}' which is not defined on any subject namespace of '${expr.tupleRelation}'`,
        );
    }
};

/** Recursively validate that every reference inside a permission expression resolves; dispatches on node kind. */
const checkExprRefs = (scope: RefScope, ns: NamespaceNode, where: PermissionNode, expr: ExprNode): void => {
    switch (expr.kind) {
        case 'ref':
            return checkRefExpr(scope, ns, where, expr);
        case 'ttu':
            return checkTtuExpr(scope, ns, where, expr);
        case 'union':
        case 'intersection':
            if (expr.children.length === 0) {
                fail(scope.opts, expr.loc, `${ns.name}.${where.name}: ${expr.kind} requires at least one child`);
            }
            expr.children.forEach(c => checkExprRefs(scope, ns, where, c));
            return;
        case 'exclusion':
            checkExprRefs(scope, ns, where, expr.base);
            checkExprRefs(scope, ns, where, expr.subtract);
            return;
    }
};

/** Every subject of a relation must name a known namespace, and any subject userset must name a relation that exists there. */
const checkRelationSubjects = (scope: RefScope, ns: NamespaceNode, m: RelationNode): void => {
    for (const s of m.subjects) {
        const target = scope.nsByName.get(s.namespace);
        if (!target) {
            fail(scope.opts, s.loc, `${ns.name}.${m.name}: unknown subject namespace '${s.namespace}'`);
        }
        if (s.relation !== undefined) {
            const exists = target.members.some(mm => mm.name === s.relation);
            if (!exists) {
                fail(scope.opts, s.loc, `${ns.name}.${m.name}: unknown subject relation '${s.namespace}.${s.relation}'`);
            }
        }
    }
};

const validateRefs = (opts: LowerOptions, file: FileNode): void => {
    const scope: RefScope = { opts, nsByName: new Map(file.namespaces.map(n => [n.name, n] as const)) };
    for (const ns of file.namespaces) {
        for (const m of ns.members) {
            if (m.kind === 'relation') checkRelationSubjects(scope, ns, m);
            else checkExprRefs(scope, ns, m, m.expr);
        }
    }
};

/**
 * Lower a parsed {@link FileNode} into runtime `NamespaceDef`s and an
 * {@link AuthorizationModel}. Validates that every name matches
 * `[a-z][a-z0-9_]*`, that namespace / relation / permission names are
 * unique, that every reference resolves to a declared symbol, and that
 * `tupleToUserset`'s computed relation exists on at least one subject
 * namespace of the tuple relation.
 *
 * @throws {CompileError} on any local-naming, duplicate, or reference error
 *   — and as a final safety net if the constructed `AuthorizationModel`
 *   itself rejects the input.
 */
export const lower = (file: FileNode, opts: LowerOptions): LowerResult => {
    validateLocal(opts, file);
    validateRefs(opts, file);
    const namespaces = file.namespaces.map(lowerNamespace);
    let model: AuthorizationModel;
    try {
        // Final safety net — should never fire if validateRefs is exhaustive.
        model = new AuthorizationModel(namespaces);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CompileError({
            source: opts.source,
            filename: opts.filename,
            span: file.loc,
            message: `model validation failed: ${message}`,
        });
    }
    return { namespaces, model };
};
