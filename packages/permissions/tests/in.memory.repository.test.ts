import { describe, it, expect } from 'vitest';
import { InMemoryTupleRepository } from '../src/in.memory.repository.js';
import { parseTuple } from '../src/tuple.js';

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
        const repo = new InMemoryTupleRepository([
            t('doc:d1.parent@folder:f1'),
            t('doc:d1.parent@folder.*'),
            t('doc:d1.parent@org:42.admin'),
        ]);
        const parents = await repo.listObjectsRelatedBy('doc', 'd1', 'parent');
        expect(parents).toEqual([{ namespace: 'folder', id: 'f1' }]);
    });
});
