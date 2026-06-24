import { describe, it, expect, vi } from 'vitest';
import { AppConfigResolverAwsSecrets } from '../../src/resolvers/app.config.resolver.aws.secrets.js';
import { AppConfigSourceAwsSecrets } from '../../src/sources/app.config.source.aws.secrets.js';
import type { ObjectVisitorMeta } from '../../src/object.visitor.js';

// The resolver is a thin wrapper that delegates fetching to AppConfigSourceAwsSecrets.get;
// the Secrets Manager I/O is covered by the source's own test. Here we build a real source
// (its client is lazy) and stub `get`, asserting only the resolver's reference-matching and
// write-back behavior.
function stubbedResolver(get: (key: string) => Promise<unknown>, prefix?: string | RegExp): AppConfigResolverAwsSecrets {
  const source = new AppConfigSourceAwsSecrets({ region: 'us-east-1' });
  vi.spyOn(source, 'get').mockImplementation(get);
  return prefix === undefined ? new AppConfigResolverAwsSecrets(source) : new AppConfigResolverAwsSecrets(source, prefix);
}

function meta(owner: object, propertyPath: string, arrayIndex?: number): ObjectVisitorMeta {
  return { owner, propertyPath, path: propertyPath, propertyType: 'string', arrayIndex };
}

describe('AppConfigResolverAwsSecrets', () => {
  describe('canResolve()', () => {
    it('matches the default ${aws:…} pattern', () => {
      const resolver = stubbedResolver(async () => null);
      expect(resolver.canResolve('${aws:MY_SECRET}')).toBe(true);
      expect(resolver.canResolve('prefix ${aws:S} suffix')).toBe(true);
      expect(resolver.canResolve('aws:MY_SECRET')).toBe(false);
      expect(resolver.canResolve('${MY_SECRET}')).toBe(false);
    });

    it('returns true on consecutive calls (no stale /g lastIndex)', () => {
      const resolver = stubbedResolver(async () => null);
      expect(resolver.canResolve('${aws:MY_SECRET}')).toBe(true);
      expect(resolver.canResolve('${aws:MY_SECRET}')).toBe(true);
      expect(resolver.canResolve('${aws:MY_SECRET}')).toBe(true);
    });

    it('honours a string prefix and a custom regex', () => {
      expect(stubbedResolver(async () => null, 'aws:').canResolve('aws:X')).toBe(true);
      expect(stubbedResolver(async () => null, /^aws:(.+)$/).canResolve('env:X')).toBe(false);
    });
  });

  describe('resolve()', () => {
    it('delegates to the source and replaces the whole value', async () => {
      const get = vi.fn(async () => 'secret_value');
      const source = new AppConfigSourceAwsSecrets({ region: 'us-east-1' });
      vi.spyOn(source, 'get').mockImplementation(get);
      const resolver = new AppConfigResolverAwsSecrets(source);
      const owner: Record<string, unknown> = { value: '${aws:MY_SECRET}' };

      await resolver.resolve('${aws:MY_SECRET}', meta(owner, 'value'));

      expect(get).toHaveBeenCalledWith('MY_SECRET');
      expect(owner.value).toBe('secret_value');
    });

    it('writes a JSON-object secret as an object', async () => {
      const resolver = stubbedResolver(async () => ({ key: 'value', number: 42 }));
      const owner: Record<string, unknown> = { value: '${aws:JSON_SECRET}' };

      await resolver.resolve('${aws:JSON_SECRET}', meta(owner, 'value'));

      expect(owner.value).toEqual({ key: 'value', number: 42 });
    });

    it('writes into an array slot', async () => {
      const resolver = stubbedResolver(async () => 'resolved');
      const owner: string[] = ['${aws:ITEM1}', 'static'];

      await resolver.resolve('${aws:ITEM1}', meta(owner, 'items[0]', 0));

      expect(owner[0]).toBe('resolved');
      expect(owner[1]).toBe('static');
    });

    it('throws for a non-global regex (matchAll requirement)', async () => {
      const resolver = stubbedResolver(async () => 'x', /^\$\{aws:(.+)\}$/);
      await expect(resolver.resolve('${aws:SECRET}', meta({ value: '' }, 'value'))).rejects.toThrow();
    });

    it('propagates a source error', async () => {
      const resolver = stubbedResolver(async () => {
        throw new Error('boom');
      });
      await expect(resolver.resolve('${aws:X}', meta({ value: '' }, 'value'))).rejects.toThrow('boom');
    });
  });
});
