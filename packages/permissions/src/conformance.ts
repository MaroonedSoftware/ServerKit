import { AuthorizationModel, defineNamespace } from './dsl.js';
import { formatSubject, OBJECT_WILDCARD, parseTuple, stringifyTuple, type ObjectRef, type RelationTuple, type SubjectRef } from './tuple.js';
import type { PermissionsTupleRepository } from './tuples.repository.js';

/**
 * Model covering every namespace and relation {@link verifyTupleRepository}
 * writes. Wrap your repository in `ModelValidatingTupleRepository` with this
 * model, or seed your namespace table from it, if your backend rejects tuples
 * for namespaces it does not know.
 */
export const conformanceModel = new AuthorizationModel([
  defineNamespace('conformance_user', { relations: {}, permissions: {} }),
  defineNamespace('conformance_group', {
    relations: { member: { subjects: ['conformance_user'] } },
    permissions: {},
  }),
  defineNamespace('conformance_doc', {
    relations: {
      viewer: { subjects: ['conformance_user', 'conformance_user.*', 'conformance_group.member'], objectWildcard: true },
      parent: { subjects: ['conformance_group', 'conformance_group.member'] },
    },
    permissions: {},
  }),
]);

/** One contract violation found by {@link verifyTupleRepository}. */
export interface ConformanceFailure {
  /** Short, stable name of the contract rule that failed. */
  rule: string;
  /** What the repository did instead. */
  message: string;
}

/** The outcome of {@link verifyTupleRepository}. */
export interface ConformanceReport {
  /** Rules the repository satisfied. */
  passed: string[];
  /** Rules it broke. Empty means the repository conforms. */
  failures: ConformanceFailure[];
  /** Rules not run because the repository does not implement an optional method. */
  skipped: string[];
}

/** Hooks around each rule, for backends that need a clean store per rule. */
export interface ConformanceOptions {
  /** Called after each rule with the repository the factory returned for it. */
  teardown?: (repo: PermissionsTupleRepository) => void | Promise<void>;
}

class ConformanceAssertion extends Error {}

const fail = (message: string): never => {
  throw new ConformanceAssertion(message);
};

const keys = (tuples: RelationTuple[]): string[] => tuples.map(stringifyTuple).sort();
const refs = (objects: ObjectRef[]): string[] => objects.map(o => `${o.namespace}:${o.id}`).sort();

const expectSame = (actual: string[], expected: string[], what: string): void => {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (a.length !== e.length || a.some((v, i) => v !== e[i])) {
    fail(`${what}: expected [${e.join(', ')}], got [${a.join(', ')}]`);
  }
};

interface RuleContext {
  repo: PermissionsTupleRepository;
  /** Per-rule suffix, so a factory that reuses one store cannot leak rows between rules. */
  id: (base: string) => string;
  t: (template: string) => RelationTuple;
}

interface Rule {
  name: string;
  /** Optional repository method the rule needs; the rule is skipped without it. */
  needs?: 'listSubjects' | 'listObjects';
  run: (ctx: RuleContext) => Promise<void>;
}

/**
 * Every read the evaluator or a consumer can make, flattened to strings, for
 * asserting that a deleted tuple is gone from all of them.
 */
const visibleEverywhere = async (repo: PermissionsTupleRepository, tuple: RelationTuple): Promise<string[]> => {
  const where: string[] = [];
  const { object, relation, subject } = tuple;
  const key = stringifyTuple(tuple);
  if (keys(await repo.listByObjectRelation(object.namespace, object.id, relation)).includes(key)) where.push('listByObjectRelation');
  if (subject.kind === 'concrete') {
    const parents = await repo.listObjectsRelatedBy(object.namespace, object.id, relation);
    if (parents.some(p => p.namespace === subject.namespace && p.id === subject.id)) where.push('listObjectsRelatedBy');
  }
  if (repo.listSubjects && keys(await repo.listSubjects(object.namespace, object.id, relation)).includes(key)) where.push('listSubjects');
  if (repo.listObjects && refs(await repo.listObjects(object.namespace, relation, subject)).includes(`${object.namespace}:${object.id}`)) {
    where.push('listObjects');
  }
  return where;
};

const subjectOf = (t: RelationTuple): SubjectRef => t.subject;

const RULES: Rule[] = [
  {
    name: 'write.is.idempotent',
    run: async ({ repo, t }) => {
      const tuple = t('conformance_doc:d1.viewer@conformance_user:alice');
      await repo.write([tuple]);
      await repo.write([tuple]);
      expectSame(
        keys(await repo.listByObjectRelation('conformance_doc', tuple.object.id, 'viewer')),
        [stringifyTuple(tuple)],
        'tuples after writing twice',
      );
    },
  },
  {
    name: 'write.accepts.created.by',
    run: async ({ repo, t }) => {
      const tuple = t('conformance_doc:d1.viewer@conformance_user:alice');
      await repo.write([tuple], 'conformance_actor');
      expectSame(keys(await repo.listByObjectRelation('conformance_doc', tuple.object.id, 'viewer')), [stringifyTuple(tuple)], 'tuples after write');
    },
  },
  {
    name: 'delete.missing.is.noop',
    run: async ({ repo, t }) => {
      await repo.delete([t('conformance_doc:d1.viewer@conformance_user:nobody')]);
    },
  },
  {
    name: 'delete.hides.from.every.read',
    run: async ({ repo, t }) => {
      const concrete = t('conformance_doc:d1.viewer@conformance_user:alice');
      const userset = t('conformance_doc:d1.viewer@conformance_group:g1.member');
      const wildcard = t('conformance_doc:d1.viewer@conformance_user.*');
      const parent = t('conformance_doc:d1.parent@conformance_group:g1');
      await repo.write([concrete, userset, wildcard, parent]);
      await repo.delete([concrete, userset, wildcard, parent]);
      for (const tuple of [concrete, userset, wildcard, parent]) {
        const where = await visibleEverywhere(repo, tuple);
        if (where.length > 0) fail(`deleted ${stringifyTuple(tuple)} still returned by ${where.join(', ')}`);
      }
    },
  },
  {
    name: 'delete.with.deleted.by.hides.from.every.read',
    run: async ({ repo, t }) => {
      const tuple = t('conformance_doc:d1.viewer@conformance_user:alice');
      await repo.write([tuple], 'conformance_granter');
      await repo.delete([tuple], 'conformance_revoker');
      const where = await visibleEverywhere(repo, tuple);
      if (where.length > 0) fail(`tuple deleted with deletedBy still returned by ${where.join(', ')}`);
    },
  },
  {
    name: 'delete.matches.exact.shape',
    run: async ({ repo, t }) => {
      const alice = t('conformance_doc:d1.viewer@conformance_user:alice');
      const bob = t('conformance_doc:d1.viewer@conformance_user:bob');
      const otherDoc = t('conformance_doc:d2.viewer@conformance_user:alice');
      await repo.write([alice, bob, otherDoc]);
      await repo.delete([alice]);
      expectSame(keys(await repo.listByObjectRelation('conformance_doc', alice.object.id, 'viewer')), [stringifyTuple(bob)], 'tuples left on d1');
      expectSame(
        keys(await repo.listByObjectRelation('conformance_doc', otherDoc.object.id, 'viewer')),
        [stringifyTuple(otherDoc)],
        'tuples left on d2',
      );
    },
  },
  {
    name: 'rewrite.after.delete.is.visible',
    run: async ({ repo, t }) => {
      // A soft-delete table with a unique key on (object, relation, subject) tends to
      // swallow the re-grant as a duplicate of the revoked row.
      const tuple = t('conformance_doc:d1.viewer@conformance_user:alice');
      await repo.write([tuple]);
      await repo.delete([tuple]);
      await repo.write([tuple]);
      expectSame(
        keys(await repo.listByObjectRelation('conformance_doc', tuple.object.id, 'viewer')),
        [stringifyTuple(tuple)],
        'tuples after re-grant',
      );
    },
  },
  {
    name: 'related.by.returns.only.concrete.subjects',
    run: async ({ repo, t, id }) => {
      await repo.write([t('conformance_doc:d1.parent@conformance_group:g1'), t('conformance_doc:d1.parent@conformance_group:g2.member')]);
      const parents = await repo.listObjectsRelatedBy('conformance_doc', id('d1'), 'parent');
      expectSame(refs(parents), [`conformance_group:${id('g1')}`], 'parents');
    },
  },
  {
    name: 'object.wildcard.id.round.trips',
    run: async ({ repo, t }) => {
      const tuple = t('conformance_doc:*.viewer@conformance_user:alice');
      await repo.write([tuple]);
      expectSame(
        keys(await repo.listByObjectRelation('conformance_doc', OBJECT_WILDCARD, 'viewer')),
        [stringifyTuple(tuple)],
        `tuples on conformance_doc:${OBJECT_WILDCARD}`,
      );
      if (repo.listObjects) {
        expectSame(
          refs(await repo.listObjects('conformance_doc', 'viewer', subjectOf(tuple))),
          [`conformance_doc:${OBJECT_WILDCARD}`],
          'listObjects',
        );
      }
    },
  },
  {
    name: 'list.subjects.returns.tuples.on.object',
    needs: 'listSubjects',
    run: async ({ repo, t, id }) => {
      const a = t('conformance_doc:d1.viewer@conformance_user:alice');
      const g = t('conformance_doc:d1.viewer@conformance_group:g1.member');
      await repo.write([a, g, t('conformance_doc:d2.viewer@conformance_user:bob')]);
      expectSame(
        keys((await repo.listSubjects?.('conformance_doc', id('d1'), 'viewer')) ?? []),
        [stringifyTuple(a), stringifyTuple(g)],
        'listSubjects',
      );
    },
  },
  {
    name: 'list.objects.matches.exact.subject',
    needs: 'listObjects',
    run: async ({ repo, t, id }) => {
      await repo.write([
        t('conformance_doc:d1.viewer@conformance_user:alice'),
        t('conformance_doc:d2.viewer@conformance_user.*'),
        t('conformance_doc:d3.viewer@conformance_group:g1.member'),
      ]);
      const list = (subject: SubjectRef) => repo.listObjects?.('conformance_doc', 'viewer', subject) ?? Promise.resolve([]);
      const alice = subjectOf(t('conformance_doc:d1.viewer@conformance_user:alice'));
      expectSame(refs(await list(alice)), [`conformance_doc:${id('d1')}`], `listObjects for ${formatSubject(alice)}`);
      expectSame(
        refs(await list({ kind: 'wildcard', namespace: 'conformance_user' })),
        [`conformance_doc:${id('d2')}`],
        'listObjects for conformance_user.*',
      );
      expectSame(
        refs(await list({ kind: 'userset', namespace: 'conformance_group', id: id('g1'), relation: 'member' })),
        [`conformance_doc:${id('d3')}`],
        'listObjects for the group userset',
      );
    },
  },
];

/**
 * Check a {@link PermissionsTupleRepository} implementation against the
 * contract the evaluator relies on: idempotent writes, deletes that disappear
 * from **every** read (including when the backend keeps revocation history),
 * re-grants after a revoke, concrete-only parent edges, literal `*` object ids,
 * and exact-subject matching in the optional listings.
 *
 * Runner-agnostic: it returns a report instead of calling `expect`, so it works
 * under vitest, jest, or `node:test`. Each rule gets a fresh repository from
 * `factory` and uses ids suffixed per rule, so a factory that hands back the same
 * store every time still gives independent results. Point it at a disposable
 * database: it writes and deletes rows.
 *
 * @example
 * ```ts
 * const report = await verifyTupleRepository(() => new PostgresTupleRepository(testDb));
 * expect(report.failures).toEqual([]);
 * ```
 *
 * @param factory - Returns the repository to test; called once per rule.
 * @param options - Optional per-rule teardown.
 */
export const verifyTupleRepository = async (
  factory: () => PermissionsTupleRepository | Promise<PermissionsTupleRepository>,
  options: ConformanceOptions = {},
): Promise<ConformanceReport> => {
  const report: ConformanceReport = { passed: [], failures: [], skipped: [] };

  for (const [index, rule] of RULES.entries()) {
    const repo = await factory();
    if (rule.needs && !repo[rule.needs]) {
      report.skipped.push(rule.name);
      await options.teardown?.(repo);
      continue;
    }
    // Suffix every concrete id so rules cannot see each other's rows.
    const suffix = `r${index}`;
    const id = (base: string): string => `${base}_${suffix}`;
    const t = (template: string): RelationTuple => parseTuple(template.replace(/:([a-z0-9_]+)(?=[.@]|$)/g, (_match, raw: string) => `:${id(raw)}`));
    try {
      await rule.run({ repo, id, t });
      report.passed.push(rule.name);
    } catch (err) {
      report.failures.push({ rule: rule.name, message: err instanceof ConformanceAssertion ? err.message : `threw: ${String(err)}` });
    } finally {
      await options.teardown?.(repo);
    }
  }
  return report;
};
