import { describe, it, expect } from 'vitest';
import { InMemoryTupleRepository } from '../src/in.memory.repository.js';
import { formatSubject, parseTuple } from '../src/tuple.js';

const t = parseTuple;

describe('InMemoryTupleRepository', () => {
  it('returns seeded tuples for the matching (object, relation) pair', async () => {
    const repo = new InMemoryTupleRepository([
      t('doc:d1.viewer@user:alice'),
      t('doc:d1.viewer@user:bob'),
      t('doc:d2.viewer@user:alice'),
      t('doc:d1.editor@user:alice'),
    ]);
    const viewers = await repo.listByObjectRelation('doc', 'd1', 'viewer');
    expect(viewers.map(v => v.subject)).toEqual([
      { kind: 'concrete', namespace: 'user', id: 'alice' },
      { kind: 'concrete', namespace: 'user', id: 'bob' },
    ]);
  });

  it('deduplicates writes by canonical tuple string', async () => {
    const repo = new InMemoryTupleRepository();
    await repo.write([t('doc:d1.viewer@user:alice'), t('doc:d1.viewer@user:alice')]);
    expect(repo.all()).toHaveLength(1);
  });

  it('delete() removes tuples and is a no-op for missing rows', async () => {
    const repo = new InMemoryTupleRepository([t('doc:d1.viewer@user:alice')]);
    await repo.delete([t('doc:d1.viewer@user:alice'), t('doc:d1.viewer@user:bob')]);
    expect(repo.all()).toHaveLength(0);
  });

  it('listObjectsRelatedBy yields only concrete-subject parents', async () => {
    const repo = new InMemoryTupleRepository([t('doc:d1.parent@folder:f1'), t('doc:d1.parent@folder.*'), t('doc:d1.parent@org:42.admin')]);
    const parents = await repo.listObjectsRelatedBy('doc', 'd1', 'parent');
    expect(parents).toEqual([{ namespace: 'folder', id: 'f1' }]);
  });

  describe('listSubjects', () => {
    it('returns every tuple stored on an object relation', async () => {
      const repo = new InMemoryTupleRepository([
        parseTuple('document:readme.viewer@user:alice'),
        parseTuple('document:readme.viewer@user.*'),
        parseTuple('document:readme.owner@user:bob'),
        parseTuple('document:other.viewer@user:carol'),
      ]);

      const subjects = await repo.listSubjects('document', 'readme', 'viewer');

      expect(subjects.map(t => formatSubject(t.subject)).sort()).toEqual(['user.*', 'user:alice']);
    });

    it('returns wildcard and userset subjects, unlike listObjectsRelatedBy', async () => {
      const repo = new InMemoryTupleRepository([parseTuple('document:readme.viewer@org:acme.member')]);

      expect(await repo.listSubjects('document', 'readme', 'viewer')).toHaveLength(1);
      expect(await repo.listObjectsRelatedBy('document', 'readme', 'viewer')).toEqual([]);
    });

    it('returns an empty array when nothing matches', async () => {
      const repo = new InMemoryTupleRepository();
      expect(await repo.listSubjects('document', 'readme', 'viewer')).toEqual([]);
    });
  });

  describe('listObjects', () => {
    it('returns every object the subject holds the relation on', async () => {
      const repo = new InMemoryTupleRepository([
        parseTuple('document:readme.viewer@user:alice'),
        parseTuple('document:budget.viewer@user:alice'),
        parseTuple('document:secret.viewer@user:bob'),
        parseTuple('document:readme.owner@user:alice'),
      ]);

      const objects = await repo.listObjects('document', 'viewer', { kind: 'concrete', namespace: 'user', id: 'alice' });

      expect(objects.map(o => o.id).sort()).toEqual(['budget', 'readme']);
    });

    it('matches a wildcard subject exactly, not as a catch-all', async () => {
      const repo = new InMemoryTupleRepository([parseTuple('document:public.viewer@user.*'), parseTuple('document:readme.viewer@user:alice')]);

      expect(await repo.listObjects('document', 'viewer', { kind: 'wildcard', namespace: 'user' })).toEqual([
        { namespace: 'document', id: 'public' },
      ]);
      // A concrete subject covered by the wildcard is not returned: this is a
      // direct-tuple index, not a Check.
      expect(await repo.listObjects('document', 'viewer', { kind: 'concrete', namespace: 'user', id: 'bob' })).toEqual([]);
    });

    it('matches a userset subject', async () => {
      const repo = new InMemoryTupleRepository([parseTuple('document:readme.viewer@org:acme.member')]);

      const objects = await repo.listObjects('document', 'viewer', { kind: 'userset', namespace: 'org', id: 'acme', relation: 'member' });

      expect(objects).toEqual([{ namespace: 'document', id: 'readme' }]);
    });

    it('scopes results to the requested namespace', async () => {
      const repo = new InMemoryTupleRepository([parseTuple('document:readme.viewer@user:alice'), parseTuple('folder:root.viewer@user:alice')]);

      expect(await repo.listObjects('folder', 'viewer', { kind: 'concrete', namespace: 'user', id: 'alice' })).toEqual([
        { namespace: 'folder', id: 'root' },
      ]);
    });
  });
});
