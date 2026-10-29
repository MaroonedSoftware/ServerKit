import { describe, it, expect } from 'vitest';
import { AuthorizationModel, computed, defineNamespace, tupleToUserset, union } from '../src/dsl.js';
import { check, checkDetailed } from '../src/check.js';
import { explain } from '../src/explain.js';
import { InMemoryTupleRepository } from '../src/in.memory.repository.js';
import { ModelValidatingTupleRepository } from '../src/model.validating.repository.js';
import { IsPermissionsError } from '../src/errors.js';
import { ObjectRef, parseTuple, RelationTuple } from '../src/tuple.js';

const model = new AuthorizationModel([
  defineNamespace('user', { relations: {}, permissions: {} }),
  defineNamespace('folder', {
    relations: { viewer: { subjects: ['user'] } },
    permissions: {},
  }),
  defineNamespace('doc', {
    relations: {
      platform_admin: { subjects: ['user'], objectWildcard: true },
      viewer: { subjects: ['user'] },
      parent: { subjects: ['folder'], objectWildcard: true },
    },
    permissions: {
      view: union(computed('platform_admin'), computed('viewer'), tupleToUserset('parent', 'viewer')),
    },
  }),
]);

const alice = { kind: 'concrete' as const, namespace: 'user', id: 'alice' };
const bob = { kind: 'concrete' as const, namespace: 'user', id: 'bob' };
const doc = (id: string) => ({ namespace: 'doc', id });

describe('every-object tuples', () => {
  it('parse and validate as tuples while ObjectRef still rejects *', () => {
    expect(parseTuple('doc:*.platform_admin@user:alice').object).toEqual({ namespace: 'doc', id: '*' });
    expect(RelationTuple.safeParse({ object: { namespace: 'doc', id: '*' }, relation: 'viewer', subject: alice }).success).toBe(true);
    expect(ObjectRef.safeParse({ namespace: 'doc', id: '*' }).success).toBe(false);
    expect(() => parseTuple('doc:a*b.viewer@user:alice')).toThrow();
  });

  it('grants the relation on every object of the namespace', async () => {
    const repo = new InMemoryTupleRepository([parseTuple('doc:*.platform_admin@user:alice')]);

    expect(await check(model, repo, doc('d1'), 'view', alice)).toBe(true);
    expect(await check(model, repo, doc('anything'), 'platform_admin', alice)).toBe(true);
    expect(await check(model, repo, doc('d1'), 'view', bob)).toBe(false);
  });

  it('ignores a * row on a relation that did not opt in', async () => {
    // Written past the validating repository, as a raw insert would be.
    const repo = new InMemoryTupleRepository([parseTuple('doc:*.viewer@user:alice')]);

    expect(await check(model, repo, doc('d1'), 'view', alice)).toBe(false);
  });

  it('only pays the extra read on opted-in relations', async () => {
    const repo = new InMemoryTupleRepository();

    const viewer = await checkDetailed(model, repo, doc('d1'), 'viewer', alice);
    const admin = await checkDetailed(model, repo, doc('d1'), 'platform_admin', alice);

    expect(viewer.metrics.tupleReads).toBe(1);
    expect(admin.metrics.tupleReads).toBe(2);
  });

  it('makes a * parent edge a parent of every object', async () => {
    const repo = new InMemoryTupleRepository([parseTuple('doc:*.parent@folder:root'), parseTuple('folder:root.viewer@user:bob')]);

    expect(await check(model, repo, doc('d7'), 'view', bob)).toBe(true);
  });

  it('shows the * tuple as the match in explain', async () => {
    const repo = new InMemoryTupleRepository([parseTuple('doc:*.platform_admin@user:alice')]);

    const result = await explain(model, repo, doc('d1'), 'platform_admin', alice);

    expect(result.allowed).toBe(true);
    expect(result.trace.kind === 'direct' && result.trace.matched?.object).toEqual({ namespace: 'doc', id: '*' });
  });

  it('is rejected on write for a relation that did not opt in', async () => {
    const repo = new ModelValidatingTupleRepository(new InMemoryTupleRepository(), model);

    await expect(repo.write([parseTuple('doc:*.viewer@user:alice')])).rejects.toSatisfy(
      e => IsPermissionsError(e) && e.code === 'object_wildcard_not_allowed' && e.relation === 'viewer',
    );
    await expect(repo.write([parseTuple('doc:*.platform_admin@user:alice')])).resolves.toBeUndefined();
  });

  it('reports allowsObjectWildcard only for opted-in relations', () => {
    expect(model.allowsObjectWildcard('doc', 'platform_admin')).toBe(true);
    expect(model.allowsObjectWildcard('doc', 'viewer')).toBe(false);
    expect(model.allowsObjectWildcard('doc', 'view')).toBe(false);
    expect(model.allowsObjectWildcard('nope', 'viewer')).toBe(false);
  });
});
