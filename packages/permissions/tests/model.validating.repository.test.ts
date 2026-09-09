import { describe, expect, it } from 'vitest';
import { AuthorizationModel, computed, defineNamespace, direct, union } from '../src/dsl.js';
import { InMemoryTupleRepository } from '../src/in.memory.repository.js';
import { ModelValidatingTupleRepository } from '../src/model.validating.repository.js';
import { IsPermissionsError, PermissionsError } from '../src/errors.js';
import { parseTuple } from '../src/tuple.js';

const model = new AuthorizationModel([
  defineNamespace('user', { relations: {}, permissions: {} }),
  defineNamespace('org', {
    relations: { member: { subjects: ['user'] }, admin: { subjects: ['user'] } },
    permissions: { administer: computed('admin') },
  }),
  defineNamespace('document', {
    relations: {
      // `viewer` accepts a concrete user, the public wildcard, or an org userset.
      viewer: { subjects: ['user', 'user.*', 'org.member'] },
      // `owner` deliberately does not accept the wildcard: ownership is never public.
      owner: { subjects: ['user'] },
      parent: { subjects: ['org'] },
    },
    permissions: { view: union(direct(), computed('owner')) },
  }),
]);

const makeRepo = () => {
  const inner = new InMemoryTupleRepository();
  return { inner, repo: new ModelValidatingTupleRepository(inner, model) };
};

describe('AuthorizationModel.isSubjectAllowed', () => {
  it('accepts a concrete subject of a declared namespace', () => {
    expect(model.isSubjectAllowed('document', 'viewer', { kind: 'concrete', namespace: 'user', id: 'alice' })).toBe(true);
  });

  it('rejects a concrete subject of an undeclared namespace', () => {
    expect(model.isSubjectAllowed('document', 'viewer', { kind: 'concrete', namespace: 'org', id: 'acme' })).toBe(false);
  });

  it('accepts a wildcard only where the relation declares one', () => {
    expect(model.isSubjectAllowed('document', 'viewer', { kind: 'wildcard', namespace: 'user' })).toBe(true);
    expect(model.isSubjectAllowed('document', 'owner', { kind: 'wildcard', namespace: 'user' })).toBe(false);
  });

  it('does not let a bare namespace declaration grant the wildcard', () => {
    // `owner: { subjects: ['user'] }` means "some user", not "every user".
    expect(model.isSubjectAllowed('document', 'owner', { kind: 'concrete', namespace: 'user', id: 'alice' })).toBe(true);
    expect(model.isSubjectAllowed('document', 'owner', { kind: 'wildcard', namespace: 'user' })).toBe(false);
  });

  it('accepts a userset subject matching a declared namespace and relation', () => {
    expect(model.isSubjectAllowed('document', 'viewer', { kind: 'userset', namespace: 'org', relation: 'member', id: 'acme' })).toBe(true);
  });

  it('rejects a userset subject naming an undeclared relation', () => {
    expect(model.isSubjectAllowed('document', 'viewer', { kind: 'userset', namespace: 'org', relation: 'admin', id: 'acme' })).toBe(false);
  });

  it('throws a typed error for an unknown namespace', () => {
    try {
      model.isSubjectAllowed('nope', 'viewer', { kind: 'concrete', namespace: 'user', id: 'alice' });
      expect.fail('expected a PermissionsError');
    } catch (error) {
      expect(IsPermissionsError(error)).toBe(true);
      expect((error as PermissionsError).code).toBe('unknown_namespace');
    }
  });

  it('throws a typed error for an unknown relation', () => {
    try {
      model.isSubjectAllowed('document', 'nope', { kind: 'concrete', namespace: 'user', id: 'alice' });
      expect.fail('expected a PermissionsError');
    } catch (error) {
      expect((error as PermissionsError).code).toBe('unknown_relation');
      expect((error as PermissionsError).relation).toBe('nope');
    }
  });

  it('treats a permission name as an unknown relation, since permissions carry no tuples', () => {
    try {
      model.isSubjectAllowed('document', 'view', { kind: 'concrete', namespace: 'user', id: 'alice' });
      expect.fail('expected a PermissionsError');
    } catch (error) {
      expect((error as PermissionsError).code).toBe('unknown_relation');
    }
  });
});

describe('ModelValidatingTupleRepository', () => {
  it('writes a tuple whose subject the relation declares', async () => {
    const { inner, repo } = makeRepo();
    await repo.write([parseTuple('document:readme.viewer@user:alice')]);
    expect(inner.all()).toHaveLength(1);
  });

  it('rejects a tuple whose subject the relation does not declare', async () => {
    const { repo } = makeRepo();
    await expect(repo.write([parseTuple('document:readme.owner@user.*')])).rejects.toMatchObject({ code: 'subject_not_allowed' });
  });

  it('writes nothing when any tuple in the batch fails', async () => {
    const { inner, repo } = makeRepo();

    await expect(repo.write([parseTuple('document:readme.viewer@user:alice'), parseTuple('document:readme.owner@user.*')])).rejects.toBeInstanceOf(
      PermissionsError,
    );

    expect(inner.all()).toEqual([]);
  });

  it('rejects a tuple naming a relation the model does not define', async () => {
    const { repo } = makeRepo();
    await expect(repo.write([parseTuple('document:readme.editor@user:alice')])).rejects.toMatchObject({ code: 'unknown_relation' });
  });

  it('does not validate deletes', async () => {
    const { inner, repo } = makeRepo();
    // The tuple predates a model change that removed the wildcard; removing it must still work.
    await inner.write([parseTuple('document:readme.owner@user.*')]);

    await repo.delete([parseTuple('document:readme.owner@user.*')]);

    expect(inner.all()).toEqual([]);
  });

  it('passes reads straight through', async () => {
    const { repo } = makeRepo();
    await repo.write([parseTuple('document:readme.viewer@user:alice')]);

    expect(await repo.listByObjectRelation('document', 'readme', 'viewer')).toHaveLength(1);
    expect(await repo.listObjectsRelatedBy('document', 'readme', 'viewer')).toEqual([{ namespace: 'user', id: 'alice' }]);
    expect(await repo.listSubjects('document', 'readme', 'viewer')).toHaveLength(1);
    expect(await repo.listObjects('document', 'viewer', { kind: 'concrete', namespace: 'user', id: 'alice' })).toEqual([
      { namespace: 'document', id: 'readme' },
    ]);
  });

  it('forwards createdBy to the inner repository', async () => {
    const inner = new InMemoryTupleRepository();
    const seen: Array<string | undefined> = [];
    const spy = Object.assign(Object.create(Object.getPrototypeOf(inner) as object) as InMemoryTupleRepository, inner, {
      write: async (tuples: Parameters<InMemoryTupleRepository['write']>[0], createdBy?: string) => {
        seen.push(createdBy);
        await InMemoryTupleRepository.prototype.write.call(inner, tuples);
      },
    });
    const repo = new ModelValidatingTupleRepository(spy, model);

    await repo.write([parseTuple('document:readme.viewer@user:alice')], 'admin-1');

    expect(seen).toEqual(['admin-1']);
  });
});
