import { describe, it, expect } from 'vitest';
import { AuthorizationModel, computed, defineNamespace, exclusion, intersection, tupleToUserset, union } from '../src/dsl.js';
import { lookupObjects } from '../src/lookup.objects.js';
import { InMemoryTupleRepository } from '../src/in.memory.repository.js';
import { PermissionsTupleRepository } from '../src/tuples.repository.js';
import { IsPermissionsError } from '../src/errors.js';
import { parseTuple, type RelationTuple } from '../src/tuple.js';

const model = new AuthorizationModel([
  defineNamespace('user', { relations: {}, permissions: {} }),
  defineNamespace('team', {
    relations: { member: { subjects: ['user', 'team.member'] } },
    permissions: {},
  }),
  defineNamespace('folder', {
    relations: { parent: { subjects: ['folder'] }, viewer: { subjects: ['user', 'team.member'] } },
    permissions: { view: union(computed('viewer'), tupleToUserset('parent', 'view')) },
  }),
  defineNamespace('doc', {
    relations: {
      parent: { subjects: ['folder'] },
      owner: { subjects: ['user'] },
      editor: { subjects: ['user', 'team.member'] },
      viewer: { subjects: ['user', 'user.*'] },
      banned: { subjects: ['user'] },
      reviewer: { subjects: ['user'] },
      platform_admin: { subjects: ['user'], objectWildcard: true },
    },
    permissions: {
      edit: union(computed('owner'), computed('editor')),
      view: union(computed('edit'), computed('viewer'), computed('platform_admin'), tupleToUserset('parent', 'view')),
      allowed: exclusion(computed('view'), computed('banned')),
      approve: intersection(computed('edit'), computed('reviewer')),
    },
  }),
]);

const alice = { kind: 'concrete' as const, namespace: 'user', id: 'alice' };
const repoOf = (...tuples: string[]) => new InMemoryTupleRepository(tuples.map(parseTuple));
const ids = (r: { objects: Array<{ id: string }> }) => r.objects.map(o => o.id).sort();

describe('lookupObjects', () => {
  it('lists direct and computed grants', async () => {
    const repo = repoOf('doc:d1.owner@user:alice', 'doc:d2.viewer@user:alice', 'doc:d3.owner@user:bob');

    const result = await lookupObjects(model, repo, 'doc', 'view', alice);

    expect(ids(result)).toEqual(['d1', 'd2']);
    expect(result.everyObject).toBe(false);
    expect(result.maxDepthExceeded).toBe(false);
  });

  it('includes public grants made to user.*', async () => {
    const result = await lookupObjects(model, repoOf('doc:pub.viewer@user.*'), 'doc', 'view', alice);

    expect(ids(result)).toEqual(['pub']);
  });

  it('follows nested groups through userset subjects', async () => {
    const repo = repoOf('team:inner.member@user:alice', 'team:outer.member@team:inner.member', 'doc:d1.editor@team:outer.member');

    expect(ids(await lookupObjects(model, repo, 'doc', 'edit', alice))).toEqual(['d1']);
  });

  it('walks a recursive folder hierarchy to every descendant', async () => {
    const repo = repoOf(
      'folder:root.viewer@user:alice',
      'folder:a.parent@folder:root',
      'folder:b.parent@folder:a',
      'doc:d1.parent@folder:b',
      'doc:d2.parent@folder:root',
      'doc:d3.parent@folder:elsewhere',
    );

    expect(ids(await lookupObjects(model, repo, 'doc', 'view', alice))).toEqual(['d1', 'd2']);
    expect(ids(await lookupObjects(model, repo, 'folder', 'view', alice))).toEqual(['a', 'b', 'root']);
  });

  it('applies exclusion through the confirming check', async () => {
    const repo = repoOf('doc:d1.owner@user:alice', 'doc:d2.owner@user:alice', 'doc:d2.banned@user:alice');

    const result = await lookupObjects(model, repo, 'doc', 'allowed', alice);

    expect(ids(result)).toEqual(['d1']);
    expect(result.candidates).toBe(2);
  });

  it('applies intersection through the confirming check', async () => {
    const repo = repoOf('doc:d1.owner@user:alice', 'doc:d1.reviewer@user:alice', 'doc:d2.owner@user:alice', 'doc:d3.reviewer@user:alice');

    expect(ids(await lookupObjects(model, repo, 'doc', 'approve', alice))).toEqual(['d1']);
  });

  it('reports an every-object grant instead of listing it', async () => {
    const repo = repoOf('doc:*.platform_admin@user:alice', 'doc:d1.owner@user:alice');

    const result = await lookupObjects(model, repo, 'doc', 'view', alice);

    expect(result.everyObject).toBe(true);
    expect(ids(result)).toEqual(['d1']);
  });

  it('ignores a * row on a relation that did not opt in', async () => {
    const result = await lookupObjects(model, repoOf('doc:*.owner@user:alice'), 'doc', 'view', alice);

    expect(result.everyObject).toBe(false);
    expect(result.objects).toEqual([]);
  });

  it('flags maxDepthExceeded when the walk is cut short', async () => {
    const tuples = ['folder:f0.viewer@user:alice'];
    for (let i = 1; i <= 6; i++) tuples.push(`folder:f${i}.parent@folder:f${i - 1}`);
    const repo = repoOf(...tuples);

    const capped = await lookupObjects(model, repo, 'folder', 'view', alice, { maxDepth: 3 });
    const full = await lookupObjects(model, repo, 'folder', 'view', alice, { maxDepth: 64 });

    expect(capped.maxDepthExceeded).toBe(true);
    expect(full.maxDepthExceeded).toBe(false);
    expect(ids(full)).toHaveLength(7);
  });

  it('does not flag maxDepthExceeded when the frontier has nothing left to follow', async () => {
    const result = await lookupObjects(model, repoOf('doc:d1.banned@user:alice'), 'doc', 'banned', alice, { maxDepth: 1 });

    expect(result.maxDepthExceeded).toBe(false);
    expect(ids(result)).toEqual(['d1']);
  });

  it('throws on an unknown permission, a non-concrete subject, or a repository without listObjects', async () => {
    await expect(lookupObjects(model, repoOf(), 'doc', 'nope', alice)).rejects.toSatisfy(e => IsPermissionsError(e) && e.code === 'unknown_relation');
    await expect(lookupObjects(model, repoOf(), 'doc', 'view', { kind: 'wildcard', namespace: 'user' })).rejects.toThrow(TypeError);

    class NoListing extends PermissionsTupleRepository {
      async write(): Promise<void> {}
      async delete(): Promise<void> {}
      async listByObjectRelation(): Promise<RelationTuple[]> {
        return [];
      }
      async listObjectsRelatedBy() {
        return [];
      }
    }
    await expect(lookupObjects(model, new NoListing(), 'doc', 'view', alice)).rejects.toThrow(/listObjects/);
  });
});
