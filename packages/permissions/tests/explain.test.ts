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
import { explain, formatTrace, type CheckTrace } from '../src/explain.js';
import { InMemoryTupleRepository } from '../src/in.memory.repository.js';
import { parseTuple } from '../src/tuple.js';

const userNs = defineNamespace('user', { relations: {}, permissions: {} });

const model = new AuthorizationModel([
    userNs,
    defineNamespace('folder', {
        relations: { viewer: { subjects: ['user', 'user.*'] } },
        permissions: {},
    }),
    defineNamespace('doc', {
        relations: {
            parent: { subjects: ['folder'] },
            owner: { subjects: ['user'] },
            editor: { subjects: ['user'] },
            banned: { subjects: ['user'] },
            viewer: { subjects: ['user', 'user.*'] },
        },
        permissions: {
            edit: union(computed('owner'), computed('editor')),
            view: union(computed('edit'), computed('viewer'), tupleToUserset('parent', 'viewer')),
            allowed: exclusion(computed('view'), computed('banned')),
            owner_and_editor: intersection(computed('owner'), computed('editor')),
            self: direct(),
        },
    }),
]);

const obj = { namespace: 'doc', id: 'd1' };
const alice = { kind: 'concrete' as const, namespace: 'user', id: 'alice' };
const bob = { kind: 'concrete' as const, namespace: 'user', id: 'bob' };

describe('explain — operators', () => {
    it('produces a union trace that records which child satisfied the check', async () => {
        const repo = new InMemoryTupleRepository([parseTuple('doc:d1.editor@user:alice')]);
        const result = await explain(model, repo, obj, 'edit', alice);
        expect(result.allowed).toBe(true);
        expect(result.trace.kind).toBe('union');
        const u = result.trace as Extract<CheckTrace, { kind: 'union' }>;
        expect(u.children.map(c => c.allowed)).toEqual([false, true]);
    });

    it('records direct tuples examined, including the matched one', async () => {
        const repo = new InMemoryTupleRepository([
            parseTuple('doc:d1.viewer@user:carol'),
            parseTuple('doc:d1.viewer@user:alice'),
        ]);
        const result = await explain(model, repo, obj, 'viewer', alice);
        expect(result.allowed).toBe(true);
        const d = result.trace as Extract<CheckTrace, { kind: 'direct' }>;
        expect(d.kind).toBe('direct');
        expect(d.tuplesExamined).toHaveLength(2);
        expect(d.matched?.subject).toMatchObject({ id: 'alice' });
    });

    it('traces a tupleToUserset path through a parent folder', async () => {
        const repo = new InMemoryTupleRepository([
            parseTuple('doc:d1.parent@folder:eng'),
            parseTuple('folder:eng.viewer@user:bob'),
        ]);
        const result = await explain(model, repo, obj, 'view', bob);
        expect(result.allowed).toBe(true);
        const root = result.trace as Extract<CheckTrace, { kind: 'union' }>;
        const ttu = root.children.find(c => c.kind === 'tupleToUserset') as Extract<CheckTrace, { kind: 'tupleToUserset' }>;
        expect(ttu).toBeDefined();
        expect(ttu.parents).toHaveLength(1);
        expect(ttu.parents[0]!.parent).toEqual({ namespace: 'folder', id: 'eng' });
        expect(ttu.allowed).toBe(true);
    });

    it('intersection denies unless every child allows, and trace records each child', async () => {
        const repo = new InMemoryTupleRepository([parseTuple('doc:d1.owner@user:alice')]);
        const result = await explain(model, repo, obj, 'owner_and_editor', alice);
        expect(result.allowed).toBe(false);
        const i = result.trace as Extract<CheckTrace, { kind: 'intersection' }>;
        expect(i.kind).toBe('intersection');
        expect(i.children.map(c => c.allowed)).toEqual([true, false]);
    });

    it('exclusion denies when subtract is allowed', async () => {
        const repo = new InMemoryTupleRepository([
            parseTuple('doc:d1.viewer@user:alice'),
            parseTuple('doc:d1.banned@user:alice'),
        ]);
        const result = await explain(model, repo, obj, 'allowed', alice);
        expect(result.allowed).toBe(false);
        const e = result.trace as Extract<CheckTrace, { kind: 'exclusion' }>;
        expect(e.kind).toBe('exclusion');
        expect(e.base.allowed).toBe(true);
        expect(e.subtract.allowed).toBe(true);
    });

    it('follows userset subjects into a child trace', async () => {
        const repo = new InMemoryTupleRepository([
            parseTuple('doc:d1.editor@folder:eng.viewer'),
            parseTuple('folder:eng.viewer@user:alice'),
        ]);
        const result = await explain(model, repo, obj, 'editor', alice);
        expect(result.allowed).toBe(true);
        const d = result.trace as Extract<CheckTrace, { kind: 'direct' }>;
        expect(d.usersetChild).toBeDefined();
        expect(d.usersetChild?.allowed).toBe(true);
    });

    it('formatTrace renders a readable indented tree', async () => {
        const repo = new InMemoryTupleRepository([parseTuple('doc:d1.owner@user:alice')]);
        const result = await explain(model, repo, obj, 'edit', alice);
        const out = formatTrace(result.trace);
        expect(out).toContain('union');
        expect(out).toContain('computed → owner');
        expect(out).toContain('direct doc:d1.owner');
    });
});
