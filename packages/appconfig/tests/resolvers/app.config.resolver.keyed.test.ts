import { describe, it, expect, vi } from 'vitest';
import { AppConfigKeyedResolver } from '../../src/resolvers/app.config.resolver.keyed.js';
import type { AppConfigSource } from '../../src/app.config.source.js';
import type { ObjectVisitorMeta } from '../../src/object.visitor.js';

function meta(owner: object, propertyPath: string, arrayIndex?: number): ObjectVisitorMeta {
  return { owner, propertyPath, path: propertyPath, propertyType: 'string', arrayIndex };
}

/** A minimal source whose `get` drives the resolver (`load` is unused here). */
function source(get: (key: string) => Promise<unknown>): AppConfigSource {
  return { load: async () => ({}), get };
}

describe('AppConfigKeyedResolver', () => {
  it('resolves a reference by delegating to the source, replacing the whole value', async () => {
    const get = vi.fn(async (key: string) => ({ resolved: key }));
    const resolver = new AppConfigKeyedResolver(source(get), /\$\{vault:(.+)\}/g);
    const owner: Record<string, unknown> = { value: '${vault:db}' };

    expect(resolver.canResolve('${vault:db}')).toBe(true);
    await resolver.resolve('${vault:db}', meta(owner, 'value'));

    expect(get).toHaveBeenCalledWith('db');
    expect(owner.value).toEqual({ resolved: 'db' });
  });

  it('writes into the array slot when the value is an array element', async () => {
    const resolver = new AppConfigKeyedResolver(
      source(async () => 'secret'),
      /\$\{vault:(.+)\}/g,
    );
    const owner: unknown[] = ['${vault:item}', 'static'];

    await resolver.resolve('${vault:item}', meta(owner, 'items[0]', 0));

    expect(owner[0]).toBe('secret');
    expect(owner[1]).toBe('static');
  });

  it('leaves the value untouched when the source returns undefined (tolerated miss)', async () => {
    const resolver = new AppConfigKeyedResolver(
      source(async () => undefined),
      /\$\{vault:(.+)\}/g,
    );
    const owner: Record<string, unknown> = { value: '${vault:gone}' };

    await resolver.resolve('${vault:gone}', meta(owner, 'value'));

    expect(owner.value).toBe('${vault:gone}');
  });

  it('returns false from canResolve for non-matching values', () => {
    const resolver = new AppConfigKeyedResolver(
      source(async () => null),
      /\$\{vault:(.+)\}/g,
    );
    expect(resolver.canResolve('plain')).toBe(false);
    expect(resolver.canResolve('${other:x}')).toBe(false);
  });

  it('compiles a string prefix into a global regex so resolve does not throw', async () => {
    // A string prefix compiles to `new RegExp(prefix)`, which is non-global; `matchAll`
    // in resolve() would throw without the constructor forcing the `g` flag.
    const get = vi.fn(async (key: string) => `value-for-${key}`);
    const resolver = new AppConfigKeyedResolver(source(get), '\\$\\{vault:([^}]+)\\}');
    const owner: Record<string, unknown> = { value: '${vault:db}' };

    expect(resolver.canResolve('${vault:db}')).toBe(true);
    await resolver.resolve('${vault:db}', meta(owner, 'value'));

    expect(get).toHaveBeenCalledWith('db');
    expect(owner.value).toBe('value-for-db');
  });

  it('propagates a source error', async () => {
    const resolver = new AppConfigKeyedResolver(
      source(async () => {
        throw new Error('boom');
      }),
      /\$\{vault:(.+)\}/g,
    );

    await expect(resolver.resolve('${vault:x}', meta({ value: '' }, 'value'))).rejects.toThrow('boom');
  });
});
