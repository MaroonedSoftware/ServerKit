import { describe, expect, it } from 'vitest';
import { lower } from '../src/lower.js';
import { parse } from '../src/parser.js';
import { CompileError } from '../src/diagnostics.js';

const compile = (source: string) => {
    const file = parse({ source, filename: 'inline.perm' });
    return lower(file, { source, filename: 'inline.perm' });
};

describe('lower', () => {
    it('produces an AuthorizationModel for a valid file', () => {
        const r = compile(`
namespace user { relation self: user }
namespace doc {
  relation owner: user
  permission edit = owner
}`);
        expect(r.namespaces.map(n => n.name).sort()).toEqual(['doc', 'user']);
        expect(r.model.get('doc')).toBeDefined();
    });

    it('lowers expressions to UsersetExpr trees', () => {
        const r = compile(`
namespace user { relation self: user }
namespace folder { relation viewer: user }
namespace doc {
  relation parent: folder
  relation owner: user
  relation editor: user
  relation banned: user
  permission edit = owner | editor
  permission view = edit | parent->viewer
  permission allowed = edit - banned
}`);
        const doc = r.namespaces.find(n => n.name === 'doc')!;
        expect(doc.permissions.edit).toEqual({
            kind: 'union',
            children: [
                { kind: 'computed', relation: 'owner' },
                { kind: 'computed', relation: 'editor' },
            ],
        });
        expect(doc.permissions.view).toMatchObject({
            kind: 'union',
            children: [
                { kind: 'computed', relation: 'edit' },
                { kind: 'tupleToUserset', tupleRelation: 'parent', computedRelation: 'viewer' },
            ],
        });
        expect(doc.permissions.allowed).toEqual({
            kind: 'exclusion',
            base: { kind: 'computed', relation: 'edit' },
            subtract: { kind: 'computed', relation: 'banned' },
        });
    });

    it('rejects references to unknown relations/permissions', () => {
        expect(() =>
            compile(`namespace user { relation self: user }
namespace doc {
  relation owner: user
  permission edit = owner | bogus
}`),
        ).toThrow(/reference to unknown 'bogus'/);
    });

    it('rejects unknown subject namespaces', () => {
        expect(() => compile(`namespace doc { relation owner: ghost }`)).toThrow(/unknown subject namespace 'ghost'/);
    });

    it('rejects names declared as both relation and permission', () => {
        expect(() =>
            compile(`namespace user { relation self: user }
namespace doc {
  relation x: user
  permission x = x
}`),
        ).toThrow(/declared as both/);
    });

    it('rejects tupleToUserset against an unknown tuple relation', () => {
        expect(() =>
            compile(`namespace user { relation self: user }
namespace doc {
  permission view = ghost->viewer
}`),
        ).toThrow(/walks unknown tuple relation 'ghost'/);
    });

    it('rejects tupleToUserset whose computed relation does not exist on any subject namespace', () => {
        expect(() =>
            compile(`namespace user { relation self: user }
namespace folder { relation viewer: user }
namespace doc {
  relation parent: folder
  permission view = parent->ghost
}`),
        ).toThrow(/'ghost' which is not defined on any subject namespace of 'parent'/);
    });

    it('error messages include file:line:col and a caret', () => {
        try {
            compile(`namespace user { relation self: user }
namespace doc {
  relation owner: user
  permission edit = owner | bogus
}`);
            throw new Error('expected throw');
        } catch (e) {
            expect(e).toBeInstanceOf(CompileError);
            if (e instanceof CompileError) {
                expect(e.message).toMatch(/inline\.perm:4:\d+ error:/);
                expect(e.message).toContain('^');
            }
        }
    });
});
