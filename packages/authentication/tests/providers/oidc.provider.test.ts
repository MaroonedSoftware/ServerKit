import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openid-client', () => ({
  None: vi.fn(),
  discovery: vi.fn(),
  allowInsecureRequests: vi.fn(),
}));

import * as openidClient from 'openid-client';
import { OidcProviderConfig, OidcProviderRegistry, OidcProviderRegistryConfig, OidcProviderSource } from '../../src/providers/oidc.provider.js';
import { Logger } from '@maroonedsoftware/logger';

const makeConfiguration = (issuer = 'https://accounts.google.com'): openidClient.Configuration =>
  ({ serverMetadata: () => ({ issuer }) }) as unknown as openidClient.Configuration;

const makeLogger = () =>
  ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }) as unknown as Logger;

const PROVIDER: OidcProviderConfig = {
  name: 'google',
  issuer: new URL('https://accounts.google.com'),
  clientId: 'client-id',
  clientSecret: 'client-secret',
  scopes: ['openid', 'profile', 'email'],
  redirectUri: new URL('https://app.example.com/auth/callback'),
};

const makeRegistry = (overrides: Partial<OidcProviderConfig> = {}, logger: Logger = makeLogger()) =>
  new OidcProviderRegistry(new OidcProviderRegistryConfig([{ ...PROVIDER, ...overrides }]), logger);

/** A source whose rows the test can change between lookups, the way a settings-backed one would. */
class MutableSource extends OidcProviderSource {
  rows: OidcProviderConfig[];

  constructor(rows: OidcProviderConfig[] = []) {
    super();
    this.rows = rows;
  }

  async list() {
    return this.rows;
  }
}

/** A promise the test settles by hand, to hold a discovery in flight. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('OidcProviderRegistryConfig', () => {
  it('is the default provider source and lists its static providers', async () => {
    const config = new OidcProviderRegistryConfig([PROVIDER]);

    expect(config).toBeInstanceOf(OidcProviderSource);
    expect(await config.list()).toEqual([PROVIDER]);
  });

  it('lists nothing when constructed without providers', async () => {
    expect(await new OidcProviderRegistryConfig().list()).toEqual([]);
  });
});

describe('OidcProviderRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches the resolved Configuration so discovery only runs once per provider', async () => {
    const fakeConfig = {} as openidClient.Configuration;
    vi.mocked(openidClient.discovery).mockResolvedValue(fakeConfig);
    const registry = makeRegistry();

    const a = await registry.getConfiguration('google');
    const b = await registry.getConfiguration('google');

    expect(a).toBe(b);
    expect(openidClient.discovery).toHaveBeenCalledTimes(1);
  });

  it('shares one discovery between concurrent lookups', async () => {
    const pending = deferred<openidClient.Configuration>();
    vi.mocked(openidClient.discovery).mockReturnValueOnce(pending.promise);
    const registry = makeRegistry();

    const both = Promise.all([registry.getConfiguration('google'), registry.getConfiguration('google')]);
    pending.resolve(makeConfiguration());
    const [a, b] = await both;

    expect(a).toBe(b);
    expect(openidClient.discovery).toHaveBeenCalledTimes(1);
  });

  it('drops a rejected discovery promise from the cache so it can be retried', async () => {
    vi.mocked(openidClient.discovery).mockRejectedValueOnce(new Error('boom'));
    const registry = makeRegistry();

    await expect(registry.getConfiguration('google')).rejects.toThrow('boom');

    vi.mocked(openidClient.discovery).mockResolvedValueOnce({} as openidClient.Configuration);
    await expect(registry.getConfiguration('google')).resolves.toBeDefined();
    expect(openidClient.discovery).toHaveBeenCalledTimes(2);
  });

  it('returns the listed configuration', async () => {
    const registry = makeRegistry();
    await expect(registry.getConfig('google')).resolves.toMatchObject({ name: 'google', clientId: 'client-id' });
  });

  it('reports public clients when clientSecret is omitted', async () => {
    const registry = makeRegistry({ clientSecret: undefined });
    await expect(registry.isPublicClient('google')).resolves.toBe(true);
  });

  it('reports confidential clients when clientSecret is set', async () => {
    await expect(makeRegistry().isPublicClient('google')).resolves.toBe(false);
  });

  it('uses None client authentication for public clients', async () => {
    const noneStub = vi.fn();
    vi.mocked(openidClient.None).mockImplementation(noneStub as never);
    vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
    const registry = makeRegistry({ clientSecret: undefined });

    await registry.getConfiguration('google');

    expect(openidClient.None).toHaveBeenCalled();
  });

  it('throws 404 for an unknown provider', async () => {
    const registry = makeRegistry();
    await expect(registry.getConfig('unknown')).rejects.toMatchObject({ statusCode: 404, details: { provider: 'unknown provider' } });
    await expect(registry.getConfiguration('unknown')).rejects.toMatchObject({ statusCode: 404 });
    await expect(registry.isPublicClient('unknown')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lists provider names, first entry winning on a duplicate', async () => {
    const source = new MutableSource([PROVIDER, { ...PROVIDER, name: 'okta' }, { ...PROVIDER, clientId: 'second-google' }]);
    const registry = new OidcProviderRegistry(source, makeLogger());

    await expect(registry.listProviders()).resolves.toEqual(['google', 'okta']);
    await expect(registry.getConfig('google')).resolves.toMatchObject({ clientId: 'client-id' });
  });

  describe('with a source that changes at runtime', () => {
    it('finds a provider added after the registry was built, without a rebuild', async () => {
      vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
      const source = new MutableSource();
      const registry = new OidcProviderRegistry(source, makeLogger());

      await expect(registry.getConfig('google')).rejects.toMatchObject({ statusCode: 404 });

      source.rows = [PROVIDER];

      await expect(registry.getConfig('google')).resolves.toMatchObject({ name: 'google' });
      await expect(registry.getConfiguration('google')).resolves.toBeDefined();
      await expect(registry.listProviders()).resolves.toEqual(['google']);
    });

    it('404s a removed provider, forgets its discovery, and rediscovers when it returns', async () => {
      vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
      const source = new MutableSource([PROVIDER]);
      const registry = new OidcProviderRegistry(source, makeLogger());
      await registry.getConfiguration('google');

      source.rows = [];
      await expect(registry.getConfiguration('google')).rejects.toMatchObject({ statusCode: 404 });

      source.rows = [PROVIDER];
      await registry.getConfiguration('google');

      expect(openidClient.discovery).toHaveBeenCalledTimes(2);
    });

    it('rediscovers when the client secret changes', async () => {
      vi.mocked(openidClient.discovery).mockResolvedValueOnce(makeConfiguration()).mockResolvedValueOnce(makeConfiguration('https://rotated'));
      const source = new MutableSource([PROVIDER]);
      const registry = new OidcProviderRegistry(source, makeLogger());
      const before = await registry.getConfiguration('google');

      source.rows = [{ ...PROVIDER, clientSecret: 'rotated-secret' }];
      const after = await registry.getConfiguration('google');

      expect(after).not.toBe(before);
      expect(openidClient.discovery).toHaveBeenCalledTimes(2);
      expect(vi.mocked(openidClient.discovery).mock.calls[1]?.[2]).toBe('rotated-secret');
    });

    it.each([
      ['issuer', { issuer: new URL('https://login.example.com') }],
      ['client id', { clientId: 'another-client' }],
      ['allowInsecureIssuer', { allowInsecureIssuer: true }],
    ])('rediscovers when the %s changes', async (_label, change) => {
      vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
      const source = new MutableSource([PROVIDER]);
      const registry = new OidcProviderRegistry(source, makeLogger());
      await registry.getConfiguration('google');

      source.rows = [{ ...PROVIDER, ...change }];
      await registry.getConfiguration('google');

      expect(openidClient.discovery).toHaveBeenCalledTimes(2);
    });

    it('does not rediscover when a new but identical row is listed', async () => {
      vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
      const source = new MutableSource([PROVIDER]);
      const registry = new OidcProviderRegistry(source, makeLogger());
      await registry.getConfiguration('google');

      // A settings-backed source rebuilds its objects on every list(); only the values matter.
      source.rows = [{ ...PROVIDER, issuer: new URL(PROVIDER.issuer.href), scopes: ['openid'] }];
      await registry.getConfiguration('google');

      expect(openidClient.discovery).toHaveBeenCalledTimes(1);
    });

    it('keeps the new discovery when an orphaned one for the old credentials fails late', async () => {
      const stale = deferred<openidClient.Configuration>();
      const fresh = makeConfiguration('https://fresh');
      vi.mocked(openidClient.discovery).mockReturnValueOnce(stale.promise).mockResolvedValueOnce(fresh);
      const source = new MutableSource([PROVIDER]);
      const registry = new OidcProviderRegistry(source, makeLogger());

      const orphaned = registry.getConfiguration('google');
      source.rows = [{ ...PROVIDER, clientSecret: 'rotated-secret' }];
      await expect(registry.getConfiguration('google')).resolves.toBe(fresh);

      stale.reject(new Error('old discovery failed'));
      await expect(orphaned).rejects.toThrow('old discovery failed');

      await expect(registry.getConfiguration('google')).resolves.toBe(fresh);
      expect(openidClient.discovery).toHaveBeenCalledTimes(2);
    });

    it('accepts a source that answers synchronously', async () => {
      const source = new (class extends OidcProviderSource {
        list() {
          return [PROVIDER];
        }
      })();
      const registry = new OidcProviderRegistry(source, makeLogger());

      await expect(registry.listProviders()).resolves.toEqual(['google']);
    });
  });

  describe('allowInsecureIssuer', () => {
    it('passes the allowInsecureRequests execute hook to discovery when the issuer is http and the flag is set', async () => {
      vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
      const registry = makeRegistry({ issuer: new URL('http://localhost:8080'), allowInsecureIssuer: true });

      await registry.getConfiguration('google');

      const lastCall = vi.mocked(openidClient.discovery).mock.calls.at(-1)!;
      // Confidential client path: (issuer, clientId, clientSecret, undefined, options)
      const options = lastCall[4] as { execute?: unknown[] } | undefined;
      expect(options?.execute).toEqual([openidClient.allowInsecureRequests]);
    });

    it('omits the execute hook on https issuers even when the flag is set', async () => {
      vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
      const registry = makeRegistry({ allowInsecureIssuer: true });

      await registry.getConfiguration('google');

      const lastCall = vi.mocked(openidClient.discovery).mock.calls.at(-1)!;
      expect(lastCall[4]).toBeUndefined();
    });

    it('warns whenever allowInsecureIssuer is set (even on https) so it is not left enabled by accident', async () => {
      vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
      const logger = makeLogger();
      const registry = makeRegistry({ allowInsecureIssuer: true }, logger);

      await registry.getConfiguration('google');

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('allowInsecureIssuer=true'));
    });

    it('does not warn when allowInsecureIssuer is unset', async () => {
      vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
      const logger = makeLogger();
      const registry = makeRegistry({}, logger);

      await registry.getConfiguration('google');

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('forwards options on the public-client path too', async () => {
      vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
      const registry = makeRegistry({ clientSecret: undefined, issuer: new URL('http://localhost:8080'), allowInsecureIssuer: true });

      await registry.getConfiguration('google');

      const lastCall = vi.mocked(openidClient.discovery).mock.calls.at(-1)!;
      // Public-client path: (issuer, clientId, undefined, None(), options)
      const options = lastCall[4] as { execute?: unknown[] } | undefined;
      expect(options?.execute).toEqual([openidClient.allowInsecureRequests]);
    });
  });
});
