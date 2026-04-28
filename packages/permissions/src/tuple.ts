import { z } from 'zod';

const NamespaceSchema = z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'namespace must match /^[a-z][a-z0-9_]*$/');

const RelationNameSchema = z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'relation must match /^[a-z][a-z0-9_]*$/');

/**
 * Reference to a concrete object: `<namespace>:<id>`.
 *
 * Validated at runtime by the exported Zod schema; the inferred type is also
 * exposed under the same name for use in TypeScript signatures.
 */
export const ObjectRef = z.object({
    namespace: NamespaceSchema,
    id: z.string().min(1),
});
export type ObjectRef = z.infer<typeof ObjectRef>;

const ConcreteSubject = z.object({
    kind: z.literal('concrete'),
    namespace: NamespaceSchema,
    id: z.string().min(1),
});
const WildcardSubject = z.object({
    kind: z.literal('wildcard'),
    namespace: NamespaceSchema,
});
const UsersetSubject = z.object({
    kind: z.literal('userset'),
    namespace: NamespaceSchema,
    id: z.string().min(1),
    relation: RelationNameSchema,
});

/**
 * Discriminated union of the three subject shapes a tuple can carry:
 *
 * - `concrete` — a specific subject (`user:alice`).
 * - `wildcard` — every subject of a namespace (`user:*`).
 * - `userset` — everyone satisfying a relation on another object
 *   (`org:42#admin`).
 */
export const SubjectRef = z.discriminatedUnion('kind', [ConcreteSubject, WildcardSubject, UsersetSubject]);
export type SubjectRef = z.infer<typeof SubjectRef>;

/**
 * Stored relation tuple: `<object>#<relation>@<subject>`. The unit of write
 * and the input shape the Check evaluator walks.
 */
export const RelationTuple = z.object({
    object: ObjectRef,
    relation: RelationNameSchema,
    subject: SubjectRef,
});
export type RelationTuple = z.infer<typeof RelationTuple>;

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

/**
 * Render a tuple in the canonical Zanzibar string form
 * (`<namespace>:<id>#<relation>@<subject>`). Useful for logs and memo keys.
 */
export const stringifyTuple = (t: RelationTuple): string => `${t.object.namespace}:${t.object.id}#${t.relation}@${formatSubject(t.subject)}`;
