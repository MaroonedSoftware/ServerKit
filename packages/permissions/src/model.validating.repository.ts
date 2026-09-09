import type { AuthorizationModel } from './dsl.js';
import type { RelationTuple } from './tuple.js';
import { PermissionsTupleRepository } from './tuples.repository.js';

/**
 * Wraps any {@link PermissionsTupleRepository} and validates tuples against an
 * {@link AuthorizationModel} before they are written.
 *
 * `RelationDef.subjects` is documented as a write-time contract, but nothing in
 * the package enforced it: {@link check} reads whatever the store returns, and no
 * shipped repository validated on the way in. A relation deliberately declared
 * without `user.*` was therefore still world-grantable by writing the tuple
 * directly. Wrap your repository in this to close that gap.
 *
 * Reads pass straight through, so this is safe to put in front of a production
 * repository. It is a decorator rather than a change to
 * {@link PermissionsTupleRepository} so a repository stays constructible without
 * a model, which is what the fixtures and the `pdsl` runner need.
 *
 * @example
 * ```ts
 * const repo = new ModelValidatingTupleRepository(new PostgresTupleRepository(db), model);
 * await repo.write([parseTuple('document:readme.viewer@user:alice')]);
 * ```
 */
export class ModelValidatingTupleRepository extends PermissionsTupleRepository {
  /**
   * @param inner - The repository that actually stores tuples.
   * @param model - Model whose relation subject declarations are enforced.
   */
  constructor(
    private readonly inner: PermissionsTupleRepository,
    private readonly model: AuthorizationModel,
  ) {
    super();
  }

  /**
   * Validate every tuple, then delegate. Nothing is written when any tuple
   * fails, so a batch is all-or-nothing with respect to validation.
   *
   * @throws {PermissionsError} `subject_not_allowed` when a tuple names a subject
   *   type its relation does not declare, or `unknown_namespace` /
   *   `unknown_relation` when the model does not define what the tuple names.
   */
  async write(tuples: RelationTuple[], createdBy?: string): Promise<void> {
    this.model.assertTuplesAllowed(tuples);
    await this.inner.write(tuples, createdBy);
  }

  /** Deletes are not validated: removing a tuple the model would reject is always safe. */
  async delete(tuples: RelationTuple[]): Promise<void> {
    await this.inner.delete(tuples);
  }

  async listByObjectRelation(namespace: string, objectId: string, relation: string): Promise<RelationTuple[]> {
    return this.inner.listByObjectRelation(namespace, objectId, relation);
  }

  async listObjectsRelatedBy(namespace: string, objectId: string, relation: string): Promise<Array<{ namespace: string; id: string }>> {
    return this.inner.listObjectsRelatedBy(namespace, objectId, relation);
  }

  async listSubjects(namespace: string, objectId: string, relation: string): Promise<RelationTuple[]> {
    return this.inner.listSubjects?.(namespace, objectId, relation) ?? [];
  }

  async listObjects(namespace: string, relation: string, subject: Parameters<NonNullable<PermissionsTupleRepository['listObjects']>>[2]) {
    return this.inner.listObjects?.(namespace, relation, subject) ?? [];
  }
}
