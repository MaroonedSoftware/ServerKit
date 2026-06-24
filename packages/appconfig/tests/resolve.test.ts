import { describe, it, expect } from 'vitest';
import { resolveValues } from '../src/resolve.js';
import type { AppConfigResolver } from '../src/app.config.resolver.js';
import type { ObjectVisitorMeta } from '../src/object.visitor.js';

/** A provider that replaces `${upper:WORD}` with the uppercased word. */
const upperProvider: AppConfigResolver = {
  canResolve: value => /\$\{upper:(.+)\}/.test(value),
  resolve: async (value: string, meta: ObjectVisitorMeta) => {
    const result = value.replace(/\$\{upper:(.+)\}/g, (_, word: string) => word.toUpperCase());
    (meta.owner as Record<string, unknown>)[meta.propertyPath] = result;
  },
};

describe('resolveValues', () => {
  it('is a no-op when no providers are given', async () => {
    const target = { a: '${upper:x}', b: 1 };
    await resolveValues(target, []);
    expect(target).toEqual({ a: '${upper:x}', b: 1 });
  });

  it('resolves matching string values in place', async () => {
    const target = { a: '${upper:hello}', b: 'plain' };
    await resolveValues(target, [upperProvider]);
    expect(target).toEqual({ a: 'HELLO', b: 'plain' });
  });

  it('leaves non-string and non-matching values untouched', async () => {
    const target = { port: 5432, host: 'localhost', flag: true };
    await resolveValues(target, [upperProvider]);
    expect(target).toEqual({ port: 5432, host: 'localhost', flag: true });
  });

  it('resolves nested values', async () => {
    const target = { db: { name: '${upper:appdb}', port: 5432 } };
    await resolveValues(target, [upperProvider]);
    expect(target).toEqual({ db: { name: 'APPDB', port: 5432 } });
  });

  it('applies the first matching provider in priority order', async () => {
    const tagA: AppConfigResolver = {
      canResolve: v => v.includes('${x}'),
      resolve: async (_v, meta) => {
        (meta.owner as Record<string, unknown>)[meta.propertyPath] = 'A';
      },
    };
    const tagB: AppConfigResolver = {
      canResolve: v => v.includes('${x}'),
      resolve: async (_v, meta) => {
        (meta.owner as Record<string, unknown>)[meta.propertyPath] = 'B';
      },
    };
    const target = { v: '${x}' };
    await resolveValues(target, [tagA, tagB]);
    expect(target).toEqual({ v: 'A' });
  });
});
