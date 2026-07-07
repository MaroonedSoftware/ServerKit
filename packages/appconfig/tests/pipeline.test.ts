import { describe, it, expect } from 'vitest';
import { buildConfigObject } from '../src/pipeline.js';
import type { AppConfigResolver } from '../src/app.config.resolver.js';
import type { ObjectVisitorMeta } from '../src/object.visitor.js';

/** A resolver that replaces `${upper:WORD}` with the uppercased word. */
const upperResolver: AppConfigResolver = {
  canResolve: value => /\$\{upper:(.+)\}/.test(value),
  resolve: async (value: string, meta: ObjectVisitorMeta) => {
    const result = value.replace(/\$\{upper:(.+)\}/g, (_, word: string) => word.toUpperCase());
    (meta.owner as Record<string, unknown>)[meta.propertyPath] = result;
  },
};

describe('buildConfigObject', () => {
  it('returns an empty object when there are no snapshots', async () => {
    const result = await buildConfigObject([], [], false);
    expect(result).toEqual({});
  });

  it('returns the merged tree unchanged when no resolvers are given', async () => {
    const result = await buildConfigObject([{ a: 1, b: 'plain' }], [], false);
    expect(result).toEqual({ a: 1, b: 'plain' });
  });

  it('merges snapshots in order with later snapshots overriding earlier ones', async () => {
    const result = await buildConfigObject([{ port: 3000, host: 'a' }, { port: 8080 }], [], false);
    expect(result).toEqual({ port: 8080, host: 'a' });
  });

  it('deep-merges nested objects across snapshots', async () => {
    const result = await buildConfigObject([{ db: { host: 'a', port: 5432 } }, { db: { host: 'b' } }], [], false);
    expect(result).toEqual({ db: { host: 'b', port: 5432 } });
  });

  it('replaces arrays with the later snapshot rather than concatenating them', async () => {
    const result = await buildConfigObject([{ a: ['*'] }, { a: ['x'] }], [], false);
    expect(result).toEqual({ a: ['x'] });
  });

  it('replaces nested arrays while still deep-merging their sibling objects', async () => {
    const result = await buildConfigObject([{ cors: { origins: ['*'], creds: { a: 1 } } }, { cors: { origins: ['x.com'], creds: { b: 2 } } }], [], false);
    expect(result).toEqual({ cors: { origins: ['x.com'], creds: { a: 1, b: 2 } } });
  });

  it('applies resolvers across the merged tree, including nested values', async () => {
    const result = await buildConfigObject(
      [{ name: '${upper:hello}', db: { user: '${upper:admin}' } }, { plain: 'kept' }],
      [upperResolver],
      false,
    );
    expect(result).toEqual({ name: 'HELLO', db: { user: 'ADMIN' }, plain: 'kept' });
  });

  it('resolves resolver tokens before merge-derived values are reference-resolved', async () => {
    // Resolver runs first, then references can point at the resolved value.
    const result = await buildConfigObject(
      [{ raw: '${upper:host}', url: '${ref:raw}/api' }],
      [upperResolver],
      true,
    );
    expect(result).toEqual({ raw: 'HOST', url: 'HOST/api' });
  });

  it('resolves ${ref:...} references when resolveRefs is true', async () => {
    const result = await buildConfigObject([{ defaults: { port: 5432 }, port: '${ref:defaults.port}' }], [], true);
    expect(result).toEqual({ defaults: { port: 5432 }, port: 5432 });
  });

  it('leaves ${ref:...} references intact when resolveRefs is false', async () => {
    const result = await buildConfigObject([{ defaults: { port: 5432 }, port: '${ref:defaults.port}' }], [], false);
    expect(result).toEqual({ defaults: { port: 5432 }, port: '${ref:defaults.port}' });
  });

  it('resolves references that span values introduced by different snapshots', async () => {
    const result = await buildConfigObject([{ host: 'db' }, { url: '${ref:host}/api' }], [], true);
    expect(result).toEqual({ host: 'db', url: 'db/api' });
  });
});
