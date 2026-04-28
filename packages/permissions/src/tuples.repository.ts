import type { RelationTuple } from './tuple.js';

/**
 * Abstract repository for the Zanzibar relation-tuple store. Implement this
 * for your storage backend — typically a Kysely-backed repo against a
 * `relation_tuples` table.
 *
 * The concrete implementation owns its own transactional context (e.g. via a
 * request-scoped `Kysely<DB>` binding). Modeled as an abstract class so the
 * runtime reference is a valid InjectKit token (interfaces aren't preserved
 * at runtime).
 */
export abstract class PermissionsTupleRepository {
    /**
     * Insert tuples idempotently. Implementations should treat duplicate
     * `(object, relation, subject)` triples as no-ops rather than errors.
     *
     * @param tuples - Tuples to persist.
     * @param createdBy - Opaque actor identifier attached to each new row when
     *   the backend records it (otherwise ignored).
     */
    abstract write(tuples: RelationTuple[], createdBy?: string): Promise<void>;

    /**
     * Remove tuples by exact shape. Tuples that don't exist are a no-op.
     */
    abstract delete(tuples: RelationTuple[]): Promise<void>;

    /**
     * All direct tuples for a `(object, relation)` pair. Feeds the Check
     * evaluator's `direct` step.
     */
    abstract listByObjectRelation(namespace: string, objectId: string, relation: string): Promise<RelationTuple[]>;

    /**
     * Concrete-subject "parent" edges for a `tupleToUserset` rewrite. Wildcard
     * and userset subjects are skipped — only the concrete subjects are
     * meaningful as parent objects.
     */
    abstract listObjectsRelatedBy(
        namespace: string,
        objectId: string,
        relation: string,
    ): Promise<Array<{ namespace: string; id: string }>>;
}
