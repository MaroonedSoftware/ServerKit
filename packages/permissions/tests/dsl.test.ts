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

describe('userset expression constructors', () => {
    it('direct returns a `direct` node', () => {
        expect(direct()).toEqual({ kind: 'direct' });
    });

    it('computed returns a `computed` node naming a relation', () => {
        expect(computed('viewer')).toEqual({ kind: 'computed', relation: 'viewer' });
    });

    it('tupleToUserset records both tuple and computed relation', () => {
        expect(tupleToUserset('parent', 'viewer')).toEqual({
            kind: 'tupleToUserset',
            tupleRelation: 'parent',
            computedRelation: 'viewer',
        });
    });

    it('union flattens variadic children into an array', () => {
        const node = union(direct(), computed('viewer'));
        expect(node).toEqual({
            kind: 'union',
            children: [{ kind: 'direct' }, { kind: 'computed', relation: 'viewer' }],
        });
    });

    it('intersection flattens variadic children into an array', () => {
        const node = intersection(direct(), computed('viewer'));
        expect(node).toEqual({
            kind: 'intersection',
            children: [{ kind: 'direct' }, { kind: 'computed', relation: 'viewer' }],
        });
    });

    it('exclusion records base and subtract', () => {
        const node = exclusion(direct(), computed('banned'));
        expect(node).toEqual({
            kind: 'exclusion',
            base: { kind: 'direct' },
            subtract: { kind: 'computed', relation: 'banned' },
        });
    });
});

describe('defineNamespace', () => {
    it('returns a NamespaceDef carrying the provided name, relations, and permissions', () => {
        const ns = defineNamespace('doc', {
            relations: { viewer: { subjects: ['user'] } },
            permissions: { view: direct() },
        });
        expect(ns.name).toBe('doc');
        expect(ns.relations.viewer.subjects).toEqual(['user']);
        expect(ns.permissions.view).toEqual({ kind: 'direct' });
    });
});

describe('AuthorizationModel construction', () => {
    const user = defineNamespace('user', { relations: {}, permissions: {} });

    it('rejects duplicate namespace names', () => {
        expect(
            () =>
                new AuthorizationModel([
                    defineNamespace('doc', { relations: {}, permissions: {} }),
                    defineNamespace('doc', { relations: {}, permissions: {} }),
                ]),
        ).toThrow(/duplicate namespace: doc/);
    });

    it('rejects malformed namespace names', () => {
        expect(() => new AuthorizationModel([defineNamespace('Doc', { relations: {}, permissions: {} })])).toThrow(
            /namespace name must match/,
        );
    });

    it('rejects malformed relation names', () => {
        expect(
            () =>
                new AuthorizationModel([
                    user,
                    defineNamespace('doc', {
                        relations: { Viewer: { subjects: ['user'] } } as never,
                        permissions: {},
                    }),
                ]),
        ).toThrow(/relation name must match/);
    });

    it('rejects subject types referencing unknown namespaces', () => {
        expect(
            () =>
                new AuthorizationModel([
                    defineNamespace('doc', {
                        relations: { viewer: { subjects: ['ghost'] } },
                        permissions: {},
                    }),
                ]),
        ).toThrow(/unknown subject namespace 'ghost'/);
    });

    it('rejects userset subject types whose relation does not exist on the target', () => {
        expect(
            () =>
                new AuthorizationModel([
                    user,
                    defineNamespace('doc', {
                        relations: { viewer: { subjects: ['user.missing'] } },
                        permissions: {},
                    }),
                ]),
        ).toThrow(/unknown subject relation 'user\.missing'/);
    });

    it('rejects a name that is declared as both a relation and a permission', () => {
        expect(
            () =>
                new AuthorizationModel([
                    user,
                    defineNamespace('doc', {
                        relations: { viewer: { subjects: ['user'] } },
                        permissions: { viewer: direct() },
                    }),
                ]),
        ).toThrow(/declared as both a relation and a permission/);
    });

    it('rejects computed expressions that reference unknown relations', () => {
        expect(
            () =>
                new AuthorizationModel([
                    user,
                    defineNamespace('doc', {
                        relations: { viewer: { subjects: ['user'] } },
                        permissions: { view: computed('editor') },
                    }),
                ]),
        ).toThrow(/computed references unknown 'editor'/);
    });

    it('rejects tupleToUserset that walks an unknown tuple relation', () => {
        expect(
            () =>
                new AuthorizationModel([
                    user,
                    defineNamespace('doc', {
                        relations: { viewer: { subjects: ['user'] } },
                        permissions: { view: tupleToUserset('parent', 'viewer') },
                    }),
                ]),
        ).toThrow(/tupleToUserset walks unknown tuple relation 'parent'/);
    });

    it("rejects tupleToUserset whose computed relation isn't defined on any subject namespace", () => {
        const folder = defineNamespace('folder', { relations: {}, permissions: {} });
        expect(
            () =>
                new AuthorizationModel([
                    user,
                    folder,
                    defineNamespace('doc', {
                        relations: {
                            viewer: { subjects: ['user'] },
                            parent: { subjects: ['folder'] },
                        },
                        permissions: { view: tupleToUserset('parent', 'viewer') },
                    }),
                ]),
        ).toThrow(/not defined on any subject namespace of 'parent'/);
    });

    it('rejects empty union and intersection', () => {
        expect(
            () =>
                new AuthorizationModel([
                    user,
                    defineNamespace('doc', {
                        relations: { viewer: { subjects: ['user'] } },
                        permissions: { view: union() },
                    }),
                ]),
        ).toThrow(/union requires at least one child/);
    });

    it('accepts a valid model and exposes namespaces() and get()', () => {
        const model = new AuthorizationModel([
            user,
            defineNamespace('doc', {
                relations: { viewer: { subjects: ['user'] } },
                permissions: { view: union(direct(), computed('viewer')) },
            }),
        ]);
        expect(model.namespaces().map(n => n.name)).toEqual(['user', 'doc']);
        expect(model.get('doc')?.name).toBe('doc');
        expect(model.get('missing')).toBeUndefined();
    });
});

describe('AuthorizationModel.resolve', () => {
    const model = new AuthorizationModel([
        defineNamespace('user', { relations: {}, permissions: {} }),
        defineNamespace('doc', {
            relations: { viewer: { subjects: ['user'] } },
            permissions: { view: computed('viewer') },
        }),
    ]);

    it('returns a `direct` expression for plain relations', () => {
        expect(model.resolve('doc', 'viewer')).toEqual({ kind: 'direct' });
    });

    it('returns the declared expression for permissions', () => {
        expect(model.resolve('doc', 'view')).toEqual({ kind: 'computed', relation: 'viewer' });
    });

    it('throws on unknown namespace', () => {
        expect(() => model.resolve('ghost', 'view')).toThrow(/unknown namespace: ghost/);
    });

    it('throws on unknown relation/permission', () => {
        expect(() => model.resolve('doc', 'missing')).toThrow(/unknown relation\/permission: doc\.missing/);
    });
});
