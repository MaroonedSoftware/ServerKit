import { describe, it, expect, vi } from 'vitest';
import { AppConfigResolverPostgres } from '../../src/resolvers/app.config.resolver.postgres.js';
import { AppConfigSourcePostgres } from '../../src/sources/app.config.source.postgres.js';
import type { ObjectVisitorMeta } from '../../src/object.visitor.js';
import type { Logger } from '@maroonedsoftware/logger';

// The resolver is a thin wrapper that delegates fetching to AppConfigSourcePostgres.get;
// the query/connection work is covered by the source's own test. Here we build a real
// source (its client is lazy — only created on load/get) and stub `get`.
const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const connection = { host: 'db', port: 5432, user: 'app', password: 'secret', database: 'app' };

function stubbedResolver(get: (key: string) => Promise<unknown>, prefix?: string | RegExp): AppConfigResolverPostgres {
  const source = new AppConfigSourcePostgres(logger, { connection });
  vi.spyOn(source, 'get').mockImplementation(get);
  return prefix === undefined ? new AppConfigResolverPostgres(source) : new AppConfigResolverPostgres(source, prefix);
}

function meta(owner: object, propertyPath: string): ObjectVisitorMeta {
  return { owner, propertyPath, path: propertyPath, propertyType: 'string' };
}

describe('AppConfigResolverPostgres', () => {
  it('matches the default ${pg:…} pattern', () => {
    const resolver = stubbedResolver(async () => null);
    expect(resolver.canResolve('${pg:feature.flag}')).toBe(true);
    expect(resolver.canResolve('pg:feature.flag')).toBe(false);
    expect(resolver.canResolve('${env:X}')).toBe(false);
  });

  it('delegates to the source and replaces the whole value', async () => {
    const get = vi.fn(async () => ({ enabled: true }));
    const resolver = stubbedResolver(get);
    const owner: Record<string, unknown> = { value: '${pg:feature.flag}' };

    await resolver.resolve('${pg:feature.flag}', meta(owner, 'value'));

    expect(get).toHaveBeenCalledWith('feature.flag');
    expect(owner.value).toEqual({ enabled: true });
  });

  it('propagates a source error (a ${pg:…} reference that cannot resolve)', async () => {
    const resolver = stubbedResolver(async () => {
      throw new Error('no value for key');
    });
    await expect(resolver.resolve('${pg:missing}', meta({ value: '' }, 'value'))).rejects.toThrow('no value for key');
  });
});
