import { describe, it, expect, vi } from 'vitest';
import { AppConfigResolverGcpSecrets } from '../../src/resolvers/app.config.resolver.gcp.secrets.js';
import type { AppConfigSourceGcpSecrets } from '../../src/sources/app.config.source.gcp.secrets.js';
import type { ObjectVisitorMeta } from '../../src/object.visitor.js';

// The resolver is a thin wrapper that delegates fetching to AppConfigSourceGcpSecrets.get;
// the GCP SDK I/O is covered by the source's own test. Here we stub the source (passed as
// the constructor's first argument, which bypasses client construction) and assert the
// resolver's reference-matching and write-back behavior.
function fakeSource(get: (key: string) => Promise<unknown>): AppConfigSourceGcpSecrets {
  return { get } as unknown as AppConfigSourceGcpSecrets;
}

function meta(owner: object, propertyPath: string, arrayIndex?: number): ObjectVisitorMeta {
  return { owner, propertyPath, path: propertyPath, propertyType: 'string', arrayIndex };
}

describe('AppConfigResolverGcpSecrets', () => {
  describe('canResolve()', () => {
    it('matches the default ${gcp:…} pattern', () => {
      const resolver = new AppConfigResolverGcpSecrets(fakeSource(async () => null));
      expect(resolver.canResolve('${gcp:MY_SECRET}')).toBe(true);
      expect(resolver.canResolve('prefix ${gcp:S} suffix')).toBe(true);
      expect(resolver.canResolve('gcp:MY_SECRET')).toBe(false);
      expect(resolver.canResolve('${MY_SECRET}')).toBe(false);
    });

    it('returns true on consecutive calls (no stale /g lastIndex)', () => {
      const resolver = new AppConfigResolverGcpSecrets(fakeSource(async () => null));
      expect(resolver.canResolve('${gcp:MY_SECRET}')).toBe(true);
      expect(resolver.canResolve('${gcp:MY_SECRET}')).toBe(true);
      expect(resolver.canResolve('${gcp:MY_SECRET}')).toBe(true);
    });

    it('honours a string prefix and a custom regex', () => {
      expect(new AppConfigResolverGcpSecrets(fakeSource(async () => null), 'gcp:').canResolve('gcp:X')).toBe(true);
      expect(new AppConfigResolverGcpSecrets(fakeSource(async () => null), /^gcp:(.+)$/).canResolve('env:X')).toBe(false);
    });
  });

  describe('resolve()', () => {
    it('delegates to the source and replaces the whole value', async () => {
      const get = vi.fn(async () => 'secret_value');
      const resolver = new AppConfigResolverGcpSecrets(fakeSource(get));
      const owner: Record<string, unknown> = { value: '${gcp:MY_SECRET}' };

      await resolver.resolve('${gcp:MY_SECRET}', meta(owner, 'value'));

      expect(get).toHaveBeenCalledWith('MY_SECRET');
      expect(owner.value).toBe('secret_value');
    });

    it('writes a JSON-object secret as an object', async () => {
      const resolver = new AppConfigResolverGcpSecrets(fakeSource(async () => ({ key: 'value', number: 42 })));
      const owner: Record<string, unknown> = { value: '${gcp:JSON_SECRET}' };

      await resolver.resolve('${gcp:JSON_SECRET}', meta(owner, 'value'));

      expect(owner.value).toEqual({ key: 'value', number: 42 });
    });

    it('writes into an array slot', async () => {
      const resolver = new AppConfigResolverGcpSecrets(fakeSource(async () => 'resolved'));
      const owner: string[] = ['${gcp:ITEM1}', 'static'];

      await resolver.resolve('${gcp:ITEM1}', meta(owner, 'items[0]', 0));

      expect(owner[0]).toBe('resolved');
      expect(owner[1]).toBe('static');
    });

    it('throws for a non-global regex (matchAll requirement)', async () => {
      const resolver = new AppConfigResolverGcpSecrets(fakeSource(async () => 'x'), /^\$\{gcp:(.+)\}$/);
      await expect(resolver.resolve('${gcp:SECRET}', meta({ value: '' }, 'value'))).rejects.toThrow();
    });

    it('propagates a source error', async () => {
      const resolver = new AppConfigResolverGcpSecrets(
        fakeSource(async () => {
          throw new Error('boom');
        }),
      );
      await expect(resolver.resolve('${gcp:X}', meta({ value: '' }, 'value'))).rejects.toThrow('boom');
    });
  });
});
