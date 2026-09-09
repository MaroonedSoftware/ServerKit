import type { ObjectRef, RelationTuple, SubjectRef } from './tuple.js';

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
  abstract listObjectsRelatedBy(namespace: string, objectId: string, relation: string): Promise<Array<{ namespace: string; id: string }>>;

  /**
   * Every tuple stored directly on `(object, relation)` — "who is on this?".
   *
   * The reverse of {@link listObjects}, and the read a membership list needs:
   * given `org:acme` and `member`, the subjects that hold it. Unlike
   * {@link listByObjectRelation}, which the evaluator calls, this is a
   * consumer-facing listing and may be paginated by the implementation.
   *
   * Optional so existing repositories keep compiling. Check for it before
   * calling; the package's own evaluation paths never use it.
   */
  listSubjects?(namespace: string, objectId: string, relation: string): Promise<RelationTuple[]>;

  /**
   * Every object on which `subject` holds `relation` — "what is this subject on?".
   *
   * The reverse index Zanzibar calls lookup-resources: given `user:alice` and
   * `viewer`, the documents she is a direct viewer of. This is a **direct-tuple**
   * lookup, not a Check: it does not expand userset rewrites, so a subject who
   * only has access through a `tupleToUserset` parent will not appear. Feed the
   * results to {@link check} when you need the effective answer.
   *
   * Optional so existing repositories keep compiling. Check for it before calling.
   */
  listObjects?(namespace: string, relation: string, subject: SubjectRef): Promise<ObjectRef[]>;
}
