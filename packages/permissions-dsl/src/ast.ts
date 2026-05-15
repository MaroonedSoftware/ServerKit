/**
 * Half-open byte range `[start, end)` inside a source string. Offsets are
 * UTF-16 code units (what `String#length` and `slice` use), matching how
 * Ohm reports match positions.
 */
export interface SourceSpan {
    start: number;
    end: number;
}

/** Mixin for AST nodes that carry their source span. */
export interface Located {
    loc: SourceSpan;
}

/** Root AST node — one parsed `.perm` source, containing one or more namespaces. */
export interface FileNode extends Located {
    kind: 'file';
    namespaces: NamespaceNode[];
}

/**
 * `namespace name { … }` declaration. `nameLoc` points specifically at the
 * identifier (so diagnostics can underline just the name) while `loc` covers
 * the whole block including braces.
 */
export interface NamespaceNode extends Located {
    kind: 'namespace';
    name: string;
    nameLoc: SourceSpan;
    members: MemberNode[];
}

/** A namespace body member — either a `relation` or a `permission` declaration. */
export type MemberNode = RelationNode | PermissionNode;

/** `relation name: subject, …` declaration listing the subject types allowed on this relation. */
export interface RelationNode extends Located {
    kind: 'relation';
    name: string;
    nameLoc: SourceSpan;
    subjects: SubjectTypeNode[];
}

/**
 * One entry in a relation's subject list. Encodes the three surface forms:
 * bare (`user`), userset (`document.owner` — `relation` set), and wildcard
 * (`user.*` — `wildcard` true).
 */
export interface SubjectTypeNode extends Located {
    kind: 'subject';
    namespace: string;
    relation?: string;
    wildcard: boolean;
}

/** `permission name = expr` declaration. `expr` is the userset rewrite tree. */
export interface PermissionNode extends Located {
    kind: 'permission';
    name: string;
    nameLoc: SourceSpan;
    expr: ExprNode;
}

/**
 * Userset rewrite expression — the body of a `permission` declaration. Lowered
 * one-to-one onto the `@maroonedsoftware/permissions` builders (`computed`,
 * `tupleToUserset`, `union`, `intersection`, `exclusion`).
 */
export type ExprNode = RefNode | TtuNode | UnionNode | IntersectionNode | ExclusionNode;

/** Reference to a sibling relation or permission by name (e.g. `owner` inside `permission edit`). */
export interface RefNode extends Located {
    kind: 'ref';
    name: string;
}

/**
 * `tupleRelation->computedRelation` — Zanzibar's tupleToUserset rewrite.
 * Walks `tupleRelation` to find a parent object then evaluates
 * `computedRelation` on it.
 */
export interface TtuNode extends Located {
    kind: 'ttu';
    tupleRelation: string;
    computedRelation: string;
}

/** N-ary union (`a | b | c`) — anyone in any child satisfies the parent. */
export interface UnionNode extends Located {
    kind: 'union';
    children: ExprNode[];
}

/** N-ary intersection (`a & b & c`) — must be in every child to satisfy the parent. */
export interface IntersectionNode extends Located {
    kind: 'intersection';
    children: ExprNode[];
}

/** Binary exclusion (`base - subtract`) — in `base` *and not* in `subtract`. */
export interface ExclusionNode extends Located {
    kind: 'exclusion';
    base: ExprNode;
    subtract: ExprNode;
}
