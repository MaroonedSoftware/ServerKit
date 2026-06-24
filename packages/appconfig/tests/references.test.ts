import { describe, it, expect } from 'vitest';
import { resolveReferences } from '../src/references.js';

describe('resolveReferences', () => {
  it('substitutes a whole-value reference by identity, preserving type', () => {
    const root = { defaults: { port: 5432 }, port: '${ref:defaults.port}' };
    resolveReferences(root);
    expect(root.port).toBe(5432);
  });

  it('substitutes a whole-value reference to an object by identity', () => {
    const root = { base: { a: 1 }, copy: '${ref:base}' };
    resolveReferences(root);
    expect(root.copy).toEqual({ a: 1 });
    expect(root.copy).toBe(root.base);
  });

  it('interpolates references inside a larger string', () => {
    const root = { host: 'db', port: 5432, url: '${ref:host}:${ref:port}' };
    resolveReferences(root);
    expect(root.url).toBe('db:5432');
  });

  it('resolves chained references in dependency order', () => {
    const root = { a: '${ref:b}', b: '${ref:c}', c: 'value' };
    resolveReferences(root);
    expect(root.a).toBe('value');
    expect(root.b).toBe('value');
  });

  it('resolves references into nested objects and array indices', () => {
    const root = { servers: [{ host: 'one' }], primary: '${ref:servers.0.host}' };
    resolveReferences(root);
    expect(root.primary).toBe('one');
  });

  it('throws with the cycle path on a reference cycle', () => {
    const root = { a: '${ref:b}', b: '${ref:a}' };
    expect(() => resolveReferences(root)).toThrow(/reference cycle: .*a.*→.*b.*→.*a|b.*→.*a.*→.*b/);
  });

  it('throws on a self-referential cycle', () => {
    const root = { a: '${ref:a}' };
    expect(() => resolveReferences(root)).toThrow(/reference cycle/);
  });

  it('throws on a reference to a missing path', () => {
    const root = { a: '${ref:does.not.exist}' };
    expect(() => resolveReferences(root)).toThrow(/does not resolve to a value/);
  });

  it('throws when a non-primitive is interpolated into a string', () => {
    const root = { obj: { a: 1 }, bad: 'prefix ${ref:obj} suffix' };
    expect(() => resolveReferences(root)).toThrow(/non-primitive and cannot be interpolated/);
  });

  it('leaves reference-free config untouched', () => {
    const root = { a: 1, b: 'plain', c: { d: true } };
    resolveReferences(root);
    expect(root).toEqual({ a: 1, b: 'plain', c: { d: true } });
  });

  it('honours a custom pattern', () => {
    const root = { host: 'db', url: '<<host>>/api' };
    resolveReferences(root, { pattern: /<<([^>]+)>>/g });
    expect(root.url).toBe('db/api');
  });

  it('shares a referenced value across multiple referrers without recomputation', () => {
    const root = { base: 'x', a: '${ref:base}', b: '${ref:base}' };
    resolveReferences(root);
    expect(root.a).toBe('x');
    expect(root.b).toBe('x');
  });
});
