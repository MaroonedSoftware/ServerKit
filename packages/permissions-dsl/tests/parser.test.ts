import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser.js';
import { ParseError } from '../src/diagnostics.js';
import type { ExprNode } from '../src/ast.js';

const p = (source: string) => parse({ source, filename: 'inline.perm' });

describe('parser', () => {
    it('parses an empty namespace', () => {
        const file = p(`namespace doc {}`);
        expect(file.namespaces).toHaveLength(1);
        expect(file.namespaces[0]!.name).toBe('doc');
        expect(file.namespaces[0]!.members).toHaveLength(0);
    });

    it('parses relations with bare, wildcard, and userset subjects', () => {
        const file = p(`namespace doc {
  relation a: user
  relation b: user.*
  relation c: org.admin
  relation d: user, user.*, org.admin
}`);
        const ns = file.namespaces[0]!;
        const [a, b, c, d] = ns.members;
        expect(a).toMatchObject({ kind: 'relation', name: 'a', subjects: [{ namespace: 'user', wildcard: false }] });
        expect(b).toMatchObject({ kind: 'relation', subjects: [{ namespace: 'user', wildcard: true }] });
        expect(c).toMatchObject({ kind: 'relation', subjects: [{ namespace: 'org', relation: 'admin', wildcard: false }] });
        expect(d).toMatchObject({ kind: 'relation', name: 'd' });
        if (d?.kind === 'relation') expect(d.subjects).toHaveLength(3);
    });

    it('parses permissions with all expression operators', () => {
        const file = p(`namespace doc {
  relation a: user
  relation b: user
  relation c: user
  relation parent: doc
  permission p1 = a
  permission p2 = a | b | c
  permission p3 = a & b & c
  permission p4 = a - b
  permission p5 = parent->a
  permission p6 = (a | b) & c - parent->a
}`);
        const ns = file.namespaces[0]!;
        const exprs = ns.members.filter(m => m.kind === 'permission').map(m => (m.kind === 'permission' ? m.expr : null) as ExprNode);
        expect(exprs[0]).toMatchObject({ kind: 'ref', name: 'a' });
        expect(exprs[1]).toMatchObject({ kind: 'union' });
        expect(exprs[2]).toMatchObject({ kind: 'intersection' });
        expect(exprs[3]).toMatchObject({ kind: 'exclusion' });
        expect(exprs[4]).toMatchObject({ kind: 'ttu', tupleRelation: 'parent', computedRelation: 'a' });
        // p6: ((a|b) & c) - parent->a — exclusion is lowest
        expect(exprs[5]).toMatchObject({ kind: 'exclusion' });
        if (exprs[5]?.kind === 'exclusion') {
            expect(exprs[5].base.kind).toBe('intersection');
            expect(exprs[5].subtract.kind).toBe('ttu');
        }
    });

    it('makes & bind tighter than |', () => {
        const file = p(`namespace doc {
  relation a: user
  relation b: user
  relation c: user
  permission p = a | b & c
}`);
        const expr = (file.namespaces[0]!.members[3] as { expr: ExprNode }).expr;
        expect(expr).toMatchObject({ kind: 'union' });
        if (expr.kind === 'union') {
            expect(expr.children[0]).toMatchObject({ kind: 'ref', name: 'a' });
            expect(expr.children[1]).toMatchObject({ kind: 'intersection' });
        }
    });

    it('makes - left-associative and binary', () => {
        const file = p(`namespace doc {
  relation a: user
  relation b: user
  relation c: user
  permission p = a - b - c
}`);
        const expr = (file.namespaces[0]!.members[3] as { expr: ExprNode }).expr;
        // (a - b) - c
        expect(expr).toMatchObject({ kind: 'exclusion' });
        if (expr.kind === 'exclusion') {
            expect(expr.base).toMatchObject({ kind: 'exclusion' });
            expect(expr.subtract).toMatchObject({ kind: 'ref', name: 'c' });
        }
    });

    it('skips // comments', () => {
        const file = p(`// header
namespace doc { // inline
  relation a: user // trailing
  permission p = a // expression
}`);
        expect(file.namespaces[0]!.members).toHaveLength(2);
    });

    it('rejects keywords as identifiers', () => {
        expect(() => p(`namespace namespace {}`)).toThrow(ParseError);
        expect(() => p(`namespace x { relation relation: user }`)).toThrow(ParseError);
    });

    it('rejects uppercase identifiers', () => {
        expect(() => p(`namespace Doc {}`)).toThrow(ParseError);
    });

    it('produces diagnostic with file:line:col for syntax errors', () => {
        try {
            p(`namespace doc {\n  relation owner user\n}`);
            throw new Error('expected throw');
        } catch (e) {
            expect(e).toBeInstanceOf(ParseError);
            if (e instanceof ParseError) expect(e.message).toMatch(/inline\.perm:2:\d+ error:/);
        }
    });
});
