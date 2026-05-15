import type { MatchResult, Node as OhmNode } from 'ohm-js';
import { grammar } from './grammar.js';
import type { ExprNode, FileNode, MemberNode, NamespaceNode, PermissionNode, RelationNode, SourceSpan, SubjectTypeNode } from './ast.js';
import { ParseError } from './diagnostics.js';

const semantics = grammar.createSemantics();

const span = (node: { source: { startIdx: number; endIdx: number } }): SourceSpan => ({
    start: node.source.startIdx,
    end: node.source.endIdx,
});

// Ohm's Node[] doesn't surface user-defined operations on its public type, so we
// adapt via `unknown` rather than re-asserting the shape on every callsite.
const callAst = <T>(node: OhmNode): T => (node as unknown as { ast(): T }).ast();

semantics.addOperation<unknown>('ast', {
    File(namespaces) {
        return {
            kind: 'file',
            loc: span(this),
            namespaces: namespaces.children.map(c => callAst<NamespaceNode>(c)),
        } satisfies FileNode;
    },
    Namespace(_kw, name, _open, members, _close) {
        return {
            kind: 'namespace',
            loc: span(this),
            name: name.sourceString,
            nameLoc: span(name),
            members: members.children.map(c => callAst<MemberNode>(c)),
        } satisfies NamespaceNode;
    },
    Member(child) {
        return child.ast();
    },
    Relation(_kw, name, _colon, subjects) {
        return {
            kind: 'relation',
            loc: span(this),
            name: name.sourceString,
            nameLoc: span(name),
            subjects: subjects.asIteration().children.map(c => callAst<SubjectTypeNode>(c)),
        } satisfies RelationNode;
    },
    SubjectType_userset(ns, _dot, rel) {
        return {
            kind: 'subject',
            loc: span(this),
            namespace: ns.sourceString,
            relation: rel.sourceString,
            wildcard: false,
        } satisfies SubjectTypeNode;
    },
    SubjectType_wildcard(ns, _dot, _star) {
        return {
            kind: 'subject',
            loc: span(this),
            namespace: ns.sourceString,
            wildcard: true,
        } satisfies SubjectTypeNode;
    },
    SubjectType_bare(ns) {
        return {
            kind: 'subject',
            loc: span(this),
            namespace: ns.sourceString,
            wildcard: false,
        } satisfies SubjectTypeNode;
    },
    Permission(_kw, name, _eq, expr) {
        return {
            kind: 'permission',
            loc: span(this),
            name: name.sourceString,
            nameLoc: span(name),
            expr: expr.ast() as ExprNode,
        } satisfies PermissionNode;
    },
    Expr(child) {
        return child.ast();
    },
    ExclusionExpr_minus(base, _minus, sub) {
        return {
            kind: 'exclusion',
            loc: span(this),
            base: base.ast() as ExprNode,
            subtract: sub.ast() as ExprNode,
        };
    },
    ExclusionExpr(child) {
        return child.ast();
    },
    UnionExpr(list) {
        const items = list.asIteration().children.map(c => callAst<ExprNode>(c));
        if (items.length === 1) return items[0]!;
        return { kind: 'union', loc: span(this), children: items };
    },
    IntersectionExpr(list) {
        const items = list.asIteration().children.map(c => callAst<ExprNode>(c));
        if (items.length === 1) return items[0]!;
        return { kind: 'intersection', loc: span(this), children: items };
    },
    Atom_group(_open, expr, _close) {
        return expr.ast();
    },
    Atom_ttu(tup, _arrow, comp) {
        return {
            kind: 'ttu',
            loc: span(this),
            tupleRelation: tup.sourceString,
            computedRelation: comp.sourceString,
        };
    },
    Atom_ref(name) {
        return { kind: 'ref', loc: span(this), name: name.sourceString };
    },
    identifier(_start, _rest) {
        return this.sourceString;
    },
});

/** Input to {@link parse}. `filename` is only used for diagnostic messages. */
export interface ParseOptions {
    filename?: string;
    source: string;
}

/**
 * Parse a `.perm` source string into a {@link FileNode} AST. Performs syntax
 * checking only — semantic validation (duplicate names, unknown references)
 * is the job of `lower`.
 *
 * @throws {ParseError} if the source does not match the grammar.
 */
export const parse = (opts: ParseOptions): FileNode => {
    const result: MatchResult = grammar.match(opts.source);
    if (result.failed()) {
        throw ParseError.fromMatchFailure(result, opts.source, opts.filename);
    }
    return callAst<FileNode>(semantics(result) as unknown as OhmNode);
};
