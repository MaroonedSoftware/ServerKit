import { describe, it, expect } from 'vitest';
import { conformanceModel, verifyTupleRepository } from '../src/conformance.js';
import { InMemoryTupleRepository } from '../src/in.memory.repository.js';
import { ModelValidatingTupleRepository } from '../src/model.validating.repository.js';
import { PermissionsTupleRepository } from '../src/tuples.repository.js';
import { formatSubject, stringifyTuple, type ObjectRef, type RelationTuple, type SubjectRef } from '../src/tuple.js';

/**
 * A soft-delete repository: revoked rows stay in the store with a flag. `forget`
 * names the read that leaves out the `revoked` filter, the bug the suite exists to catch.
 */
class SoftDeleteRepo extends PermissionsTupleRepository {
  private readonly rows = new Map<string, { tuple: RelationTuple; revoked: boolean }>();
  constructor(
    private readonly forget?: 'listObjects' | 'listObjectsRelatedBy',
    private readonly swallowRegrant = false,
  ) {
    super();
  }
  private live(read: string) {
    return [...this.rows.values()].filter(r => !r.revoked || this.forget === read).map(r => r.tuple);
  }
  async write(tuples: RelationTuple[]): Promise<void> {
    for (const t of tuples) {
      const key = stringifyTuple(t);
      const existing = this.rows.get(key);
      // A unique key on the triple turns the re-grant into a no-op on the revoked row.
      if (existing && this.swallowRegrant) continue;
      this.rows.set(key, { tuple: t, revoked: false });
    }
  }
  async delete(tuples: RelationTuple[]): Promise<void> {
    for (const t of tuples) {
      const row = this.rows.get(stringifyTuple(t));
      if (row) row.revoked = true;
    }
  }
  async listByObjectRelation(namespace: string, objectId: string, relation: string): Promise<RelationTuple[]> {
    return this.live('listByObjectRelation').filter(t => t.object.namespace === namespace && t.object.id === objectId && t.relation === relation);
  }
  async listObjectsRelatedBy(namespace: string, objectId: string, relation: string) {
    return this.live('listObjectsRelatedBy')
      .filter(t => t.object.namespace === namespace && t.object.id === objectId && t.relation === relation && t.subject.kind === 'concrete')
      .map(t => ({ namespace: t.subject.namespace, id: (t.subject as { id: string }).id }));
  }
  async listObjects(namespace: string, relation: string, subject: SubjectRef): Promise<ObjectRef[]> {
    return this.live('listObjects')
      .filter(t => t.object.namespace === namespace && t.relation === relation && formatSubject(t.subject) === formatSubject(subject))
      .map(t => t.object);
  }
}

describe('verifyTupleRepository', () => {
  it('passes the in-memory repository on every rule', async () => {
    const report = await verifyTupleRepository(() => new InMemoryTupleRepository());

    expect(report.failures).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.passed.length).toBeGreaterThan(8);
  });

  it('passes a model-validating repository built on conformanceModel', async () => {
    const report = await verifyTupleRepository(() => new ModelValidatingTupleRepository(new InMemoryTupleRepository(), conformanceModel));

    expect(report.failures).toEqual([]);
  });

  it('keeps rules independent when the factory reuses one store', async () => {
    const shared = new InMemoryTupleRepository();

    const report = await verifyTupleRepository(() => shared);

    expect(report.failures).toEqual([]);
  });

  it('passes a soft-delete repository that filters every read', async () => {
    const report = await verifyTupleRepository(() => new SoftDeleteRepo());

    expect(report.failures).toEqual([]);
    expect(report.skipped).toEqual(['list.subjects.returns.tuples.on.object']);
  });

  it.each(['listObjects', 'listObjectsRelatedBy'] as const)('names %s when it leaks a revoked row', async read => {
    const report = await verifyTupleRepository(() => new SoftDeleteRepo(read));

    const leaks = report.failures.filter(f => f.rule.startsWith('delete.') && f.rule.endsWith('hides.from.every.read'));
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.every(f => f.message.includes(`still returned by ${read}`))).toBe(true);
  });

  it('catches a re-grant swallowed by a revoked row', async () => {
    const report = await verifyTupleRepository(() => new SoftDeleteRepo(undefined, true));

    expect(report.failures.map(f => f.rule)).toEqual(['rewrite.after.delete.is.visible']);
  });

  it('reports a thrown error as a failure and still runs teardown for every rule', async () => {
    let teardowns = 0;
    class Throwing extends InMemoryTupleRepository {
      override async delete(): Promise<void> {
        throw new Error('boom');
      }
    }

    const report = await verifyTupleRepository(() => new Throwing(), { teardown: () => void teardowns++ });

    expect(report.failures.find(f => f.rule === 'delete.missing.is.noop')?.message).toBe('threw: Error: boom');
    expect(teardowns).toBe(report.passed.length + report.failures.length + report.skipped.length);
  });
});
