import { describe, it, expect } from 'vitest';
import {
    AuthorizationModel,
    computed,
    defineNamespace,
    direct,
    exclusion,
    intersection,
    tupleToUserset,
    union,
} from '../src/dsl.js';
import { PermissionsTupleRepository } from '../src/tuples.repository.js';
import type { RelationTuple } from '../src/tuple.js';
import { __testing, check } from '../src/check.js';
import { CheckMetricsSink, type CheckMetrics, type CheckMetricsTags } from '../src/check.metrics.js';

class InMemoryRepo extends PermissionsTupleRepository {
    constructor(private readonly tuples: RelationTuple[] = []) {
        super();
    }
    async write(): Promise<void> {}
    async delete(): Promise<void> {}
    async listByObjectRelation(namespace: string, objectId: string, relation: string): Promise<RelationTuple[]> {
        return this.tuples.filter(
            t => t.object.namespace === namespace && t.object.id === objectId && t.relation === relation,
        );
    }
    async listObjectsRelatedBy(namespace: string, objectId: string, relation: string) {
        return this.tuples
            .filter(
                t =>
                    t.object.namespace === namespace &&
                    t.object.id === objectId &&
                    t.relation === relation &&
                    t.subject.kind === 'concrete',
            )
            .map(t => {
                const s = t.subject as { kind: 'concrete'; namespace: string; id: string };
                return { namespace: s.namespace, id: s.id };
            });
    }
}

class CapturingSink extends CheckMetricsSink {
    public observations: Array<{ metrics: CheckMetrics; tags: CheckMetricsTags }> = [];
    record(metrics: CheckMetrics, tags: CheckMetricsTags): void {
        this.observations.push({ metrics: { ...metrics }, tags });
    }
}

const userNs = defineNamespace('user', { relations: {}, permissions: {} });

describe('check — direct tuples', () => {
    const model = new AuthorizationModel([
        userNs,
        defineNamespace('doc', {
            relations: { viewer: { subjects: ['user', 'user:*'] } },
            permissions: {},
        }),
    ]);

    it('grants when a concrete tuple matches', async () => {
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'viewer',
                subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
            },
        ]);
        const allowed = await check(model, repo, { namespace: 'doc', id: 'd1' }, 'viewer', {
            kind: 'concrete',
            namespace: 'user',
            id: 'alice',
        });
        expect(allowed).toBe(true);
    });

    it('denies when no tuple matches', async () => {
        const repo = new InMemoryRepo([]);
        const allowed = await check(model, repo, { namespace: 'doc', id: 'd1' }, 'viewer', {
            kind: 'concrete',
            namespace: 'user',
            id: 'alice',
        });
        expect(allowed).toBe(false);
    });

    it('grants any concrete subject when a wildcard tuple is stored', async () => {
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'viewer',
                subject: { kind: 'wildcard', namespace: 'user' },
            },
        ]);
        const allowed = await check(model, repo, { namespace: 'doc', id: 'd1' }, 'viewer', {
            kind: 'concrete',
            namespace: 'user',
            id: 'someone-else',
        });
        expect(allowed).toBe(true);
    });
});

describe('check — userset rewrites', () => {
    const orgNs = defineNamespace('org', {
        relations: { admin: { subjects: ['user'] } },
        permissions: {},
    });
    const docNs = defineNamespace('doc', {
        relations: {
            viewer: { subjects: ['user', 'org#admin'] },
            owner: { subjects: ['user'] },
        },
        permissions: {
            view: union(computed('viewer'), computed('owner')),
            owner_only: computed('owner'),
        },
    });
    const model = new AuthorizationModel([userNs, orgNs, docNs]);

    it('resolves through a userset subject (org#admin)', async () => {
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'viewer',
                subject: { kind: 'userset', namespace: 'org', id: 'acme', relation: 'admin' },
            },
            {
                object: { namespace: 'org', id: 'acme' },
                relation: 'admin',
                subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
            },
        ]);
        const allowed = await check(model, repo, { namespace: 'doc', id: 'd1' }, 'viewer', {
            kind: 'concrete',
            namespace: 'user',
            id: 'alice',
        });
        expect(allowed).toBe(true);
    });

    it('computed delegates to another relation on the same object', async () => {
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'owner',
                subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
            },
        ]);
        const allowed = await check(model, repo, { namespace: 'doc', id: 'd1' }, 'owner_only', {
            kind: 'concrete',
            namespace: 'user',
            id: 'alice',
        });
        expect(allowed).toBe(true);
    });

    it('union short-circuits on the first allow', async () => {
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'viewer',
                subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
            },
        ]);
        const allowed = await check(model, repo, { namespace: 'doc', id: 'd1' }, 'view', {
            kind: 'concrete',
            namespace: 'user',
            id: 'alice',
        });
        expect(allowed).toBe(true);
    });
});

describe('check — tupleToUserset', () => {
    const folderNs = defineNamespace('folder', {
        relations: { viewer: { subjects: ['user'] } },
        permissions: {},
    });
    const docNs = defineNamespace('doc', {
        relations: {
            parent: { subjects: ['folder'] },
            viewer: { subjects: ['user'] },
        },
        permissions: {
            view: union(direct(), tupleToUserset('parent', 'viewer')),
        },
    });
    const model = new AuthorizationModel([userNs, folderNs, docNs]);

    it('walks parent edges and resolves the computed relation on the parent', async () => {
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'parent',
                subject: { kind: 'concrete', namespace: 'folder', id: 'f1' },
            },
            {
                object: { namespace: 'folder', id: 'f1' },
                relation: 'viewer',
                subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
            },
        ]);
        const allowed = await check(model, repo, { namespace: 'doc', id: 'd1' }, 'view', {
            kind: 'concrete',
            namespace: 'user',
            id: 'alice',
        });
        expect(allowed).toBe(true);
    });

    it('returns false when no parent grants the computed relation', async () => {
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'parent',
                subject: { kind: 'concrete', namespace: 'folder', id: 'f1' },
            },
        ]);
        const allowed = await check(model, repo, { namespace: 'doc', id: 'd1' }, 'view', {
            kind: 'concrete',
            namespace: 'user',
            id: 'alice',
        });
        expect(allowed).toBe(false);
    });
});

describe('check — set-algebra combinators', () => {
    const docNs = defineNamespace('doc', {
        relations: {
            viewer: { subjects: ['user'] },
            owner: { subjects: ['user'] },
            banned: { subjects: ['user'] },
        },
        permissions: {
            view_and_own: intersection(computed('viewer'), computed('owner')),
            view_unless_banned: exclusion(computed('viewer'), computed('banned')),
        },
    });
    const model = new AuthorizationModel([userNs, docNs]);

    it('intersection requires every child to allow', async () => {
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'viewer',
                subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
            },
        ]);
        expect(
            await check(model, repo, { namespace: 'doc', id: 'd1' }, 'view_and_own', {
                kind: 'concrete',
                namespace: 'user',
                id: 'alice',
            }),
        ).toBe(false);
    });

    it('exclusion subtracts the second child from the first', async () => {
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'viewer',
                subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
            },
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'banned',
                subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
            },
        ]);
        expect(
            await check(model, repo, { namespace: 'doc', id: 'd1' }, 'view_unless_banned', {
                kind: 'concrete',
                namespace: 'user',
                id: 'alice',
            }),
        ).toBe(false);
    });
});

describe('check — guards', () => {
    it('cycle guard returns false rather than recursing forever', async () => {
        const model = new AuthorizationModel([
            userNs,
            defineNamespace('doc', {
                relations: { viewer: { subjects: ['user', 'doc#viewer'] } },
                permissions: {},
            }),
        ]);
        // d1 viewer -> d1#viewer (self-userset). The cycle guard should kick in.
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'viewer',
                subject: { kind: 'userset', namespace: 'doc', id: 'd1', relation: 'viewer' },
            },
        ]);
        const allowed = await check(model, repo, { namespace: 'doc', id: 'd1' }, 'viewer', {
            kind: 'concrete',
            namespace: 'user',
            id: 'alice',
        });
        expect(allowed).toBe(false);
    });

    it('exposes the MAX_DEPTH constant via __testing', () => {
        expect(__testing.MAX_DEPTH).toBe(32);
    });
});

describe('check — metrics sink', () => {
    const model = new AuthorizationModel([
        userNs,
        defineNamespace('doc', {
            relations: { viewer: { subjects: ['user'] } },
            permissions: { view: computed('viewer') },
        }),
    ]);

    it('records one observation per Check with namespace/permission/allowed tags', async () => {
        const sink = new CapturingSink();
        const repo = new InMemoryRepo([
            {
                object: { namespace: 'doc', id: 'd1' },
                relation: 'viewer',
                subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
            },
        ]);
        const allowed = await check(
            model,
            repo,
            { namespace: 'doc', id: 'd1' },
            'view',
            { kind: 'concrete', namespace: 'user', id: 'alice' },
            sink,
        );
        expect(allowed).toBe(true);
        expect(sink.observations).toHaveLength(1);
        expect(sink.observations[0]!.tags).toEqual({ namespace: 'doc', permission: 'view', allowed: true });
        expect(sink.observations[0]!.metrics.tupleReads).toBeGreaterThan(0);
        expect(sink.observations[0]!.metrics.durationMs).toBeGreaterThanOrEqual(0);
    });
});
