import { formatSubject, stringifyTuple, type ObjectRef, type RelationTuple, type SubjectRef } from './tuple.js';
import { PermissionsTupleRepository } from './tuples.repository.js';

/**
 * In-memory {@link PermissionsTupleRepository} backed by a plain array.
 * Suitable for fixtures, the `pdsl validate` runner, the VSCode playground,
 * and unit tests — anywhere a real database backend would be overkill.
 *
 * `write` and `delete` deduplicate by canonical tuple string
 * ({@link stringifyTuple}). Order is not preserved beyond that.
 */
export class InMemoryTupleRepository extends PermissionsTupleRepository {
  private readonly tuples: Map<string, RelationTuple>;

  constructor(seed: RelationTuple[] = []) {
    super();
    this.tuples = new Map(seed.map(t => [stringifyTuple(t), t]));
  }

  /** Current set of tuples, in insertion order. */
  all(): RelationTuple[] {
    return [...this.tuples.values()];
  }

  /** Drop every stored tuple. */
  clear(): void {
    this.tuples.clear();
  }

  async write(tuples: RelationTuple[]): Promise<void> {
    for (const t of tuples) this.tuples.set(stringifyTuple(t), t);
  }

  async delete(tuples: RelationTuple[]): Promise<void> {
    for (const t of tuples) this.tuples.delete(stringifyTuple(t));
  }

  async listByObjectRelation(namespace: string, objectId: string, relation: string): Promise<RelationTuple[]> {
    const out: RelationTuple[] = [];
    for (const t of this.tuples.values()) {
      if (t.object.namespace === namespace && t.object.id === objectId && t.relation === relation) out.push(t);
    }
    return out;
  }

  async listObjectsRelatedBy(namespace: string, objectId: string, relation: string): Promise<Array<{ namespace: string; id: string }>> {
    const out: Array<{ namespace: string; id: string }> = [];
    for (const t of this.tuples.values()) {
      if (t.object.namespace === namespace && t.object.id === objectId && t.relation === relation && t.subject.kind === 'concrete') {
        out.push({ namespace: t.subject.namespace, id: t.subject.id });
      }
    }
    return out;
  }

  async listSubjects(namespace: string, objectId: string, relation: string): Promise<RelationTuple[]> {
    return this.listByObjectRelation(namespace, objectId, relation);
  }

  async listObjects(namespace: string, relation: string, subject: SubjectRef): Promise<ObjectRef[]> {
    const wanted = formatSubject(subject);
    const out: ObjectRef[] = [];
    for (const t of this.tuples.values()) {
      if (t.object.namespace !== namespace || t.relation !== relation) continue;
      if (formatSubject(t.subject) === wanted) out.push(t.object);
    }
    return out;
  }
}
