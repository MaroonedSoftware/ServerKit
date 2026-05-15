import { z } from 'zod';

const NamespaceSchema = z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'namespace must match /^[a-z][a-z0-9_]*$/');

const RelationNameSchema = z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'relation must match /^[a-z][a-z0-9_]*$/');

const IdSchema = z
    .string()
    .min(1)
    .regex(/^[^.@:*]+$/, "id must not contain '.', '@', ':' or '*'");

/**
 * Reference to a concrete object: `<namespace>:<id>`.
 *
 * Validated at runtime by the exported Zod schema; the inferred type is also
 * exposed under the same name for use in TypeScript signatures.
 */
export const ObjectRef = z.object({
    namespace: NamespaceSchema,
    id: IdSchema,
});
export type ObjectRef = z.infer<typeof ObjectRef>;

const ConcreteSubject = z.object({
    kind: z.literal('concrete'),
    namespace: NamespaceSchema,
    id: IdSchema,
});
const WildcardSubject = z.object({
    kind: z.literal('wildcard'),
    namespace: NamespaceSchema,
});
const UsersetSubject = z.object({
    kind: z.literal('userset'),
    namespace: NamespaceSchema,
    id: IdSchema,
    relation: RelationNameSchema,
});

/**
 * Discriminated union of the three subject shapes a tuple can carry:
 *
 * - `concrete` — a specific subject (`user:alice`).
 * - `wildcard` — every subject of a namespace (`user.*`).
 * - `userset` — everyone satisfying a relation on another object
 *   (`org:42.admin`).
 */
export const SubjectRef = z.discriminatedUnion('kind', [ConcreteSubject, WildcardSubject, UsersetSubject]);
export type SubjectRef = z.infer<typeof SubjectRef>;

/**
 * Stored relation tuple: `<object>.<relation>@<subject>`. The unit of write
 * and the input shape the Check evaluator walks.
 */
export const RelationTuple = z.object({
    object: ObjectRef,
    relation: RelationNameSchema,
    subject: SubjectRef,
});
export type RelationTuple = z.infer<typeof RelationTuple>;

/**
 * Render a {@link SubjectRef} in its canonical string form:
 * `user:alice` (concrete), `user.*` (wildcard), or `org:42.admin` (userset).
 */
export const formatSubject = (s: SubjectRef): string => {
    switch (s.kind) {
        case 'concrete':
            return `${s.namespace}:${s.id}`;
        case 'wildcard':
            return `${s.namespace}.*`;
        case 'userset':
            return `${s.namespace}:${s.id}.${s.relation}`;
    }
};

/**
 * Render a tuple in its canonical string form
 * (`<namespace>:<id>.<relation>@<subject>`). Useful for logs and memo keys.
 */
export const stringifyTuple = (t: RelationTuple): string => `${t.object.namespace}:${t.object.id}.${t.relation}@${formatSubject(t.subject)}`;

const malformed = (input: string, reason: string): never => {
    throw new Error(`malformed tuple "${input}": ${reason}`);
};

/**
 * Parse a {@link SubjectRef} from its canonical string form. Accepts the
 * three shapes produced by {@link formatSubject}:
 *
 * - `user:alice` → `concrete`
 * - `user.*` → `wildcard`
 * - `org:42.admin` → `userset`
 *
 * Validated through the {@link SubjectRef} Zod schema; throws on any shape
 * that isn't one of the three forms or that fails namespace/id/relation rules.
 */
export const parseSubject = (input: string): SubjectRef => {
    if (input.endsWith('.*')) {
        const namespace = input.slice(0, -2);
        if (namespace.includes(':')) return malformed(input, `wildcard cannot have an id`);
        return SubjectRef.parse({ kind: 'wildcard', namespace });
    }
    const colon = input.indexOf(':');
    if (colon === -1) return malformed(input, `subject missing ':'`);
    const namespace = input.slice(0, colon);
    const rest = input.slice(colon + 1);
    const dot = rest.indexOf('.');
    if (dot !== -1) {
        return SubjectRef.parse({
            kind: 'userset',
            namespace,
            id: rest.slice(0, dot),
            relation: rest.slice(dot + 1),
        });
    }
    return SubjectRef.parse({ kind: 'concrete', namespace, id: rest });
};

/**
 * Parse a tuple from its canonical string form
 * (`<namespace>:<id>.<relation>@<subject>`) — the inverse of
 * {@link stringifyTuple}. Throws on malformed input or any field that fails
 * the {@link RelationTuple} Zod schema.
 */
export const parseTuple = (input: string): RelationTuple => {
    const at = input.indexOf('@');
    if (at === -1) return malformed(input, `missing '@'`);
    const left = input.slice(0, at);
    const right = input.slice(at + 1);
    const colon = left.indexOf(':');
    if (colon === -1) return malformed(input, `object missing ':' in "${left}"`);
    const namespace = left.slice(0, colon);
    const idAndRelation = left.slice(colon + 1);
    const dot = idAndRelation.indexOf('.');
    if (dot === -1) return malformed(input, `missing '.' between id and relation in "${left}"`);
    return RelationTuple.parse({
        object: { namespace, id: idAndRelation.slice(0, dot) },
        relation: idAndRelation.slice(dot + 1),
        subject: parseSubject(right),
    });
};
