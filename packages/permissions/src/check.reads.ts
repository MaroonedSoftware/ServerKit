// Internal: not re-exported from the barrel.
import type { AuthorizationModel } from './dsl.js';
import type { CheckMetrics } from './check.metrics.js';
import { type ObjectRef, type RelationTuple, OBJECT_WILDCARD } from './tuple.js';
import type { PermissionsTupleRepository } from './tuples.repository.js';

/**
 * Tuples on `(object, relation)`, plus the relation's every-object row when the
 * model opts the relation in. Shared by `check`, `explain`, and `lookupObjects`.
 */
export const readDirect = async (
  model: AuthorizationModel,
  repo: PermissionsTupleRepository,
  object: ObjectRef,
  relation: string,
  metrics?: CheckMetrics,
): Promise<RelationTuple[]> => {
  if (metrics) metrics.tupleReads++;
  const stored = await repo.listByObjectRelation(object.namespace, object.id, relation);
  if (!model.allowsObjectWildcard(object.namespace, relation)) return stored;
  if (metrics) metrics.tupleReads++;
  return [...stored, ...(await repo.listByObjectRelation(object.namespace, OBJECT_WILDCARD, relation))];
};

/**
 * Parent edges for a `tupleToUserset` walk, plus the relation's every-object
 * row when the model opts it in (`doc:*.parent@folder:root` makes `root` a
 * parent of every doc).
 */
export const readParentEdges = async (
  model: AuthorizationModel,
  repo: PermissionsTupleRepository,
  object: ObjectRef,
  tupleRelation: string,
  metrics?: CheckMetrics,
): Promise<ObjectRef[]> => {
  if (metrics) metrics.parentLookups++;
  const parents = await repo.listObjectsRelatedBy(object.namespace, object.id, tupleRelation);
  if (!model.allowsObjectWildcard(object.namespace, tupleRelation)) return parents;
  if (metrics) metrics.parentLookups++;
  return [...parents, ...(await repo.listObjectsRelatedBy(object.namespace, OBJECT_WILDCARD, tupleRelation))];
};
