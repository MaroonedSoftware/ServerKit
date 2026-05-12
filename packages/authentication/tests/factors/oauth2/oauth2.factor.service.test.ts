import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import {
  OAuth2FactorService,
  OAuth2FactorServiceOptions,
  OAuth2ActorEmailLookup,
} from '../../../src/factors/oauth2/oauth2.factor.service.js';
import {
  OAuth2FactorRepository,
  OAuth2Factor,
  OAuth2FactorValue,
} from '../../../src/factors/oauth2/oauth2.factor.repository.js';
import {
  OAuth2ProviderRegistry,
  OAuth2ProviderRegistryConfig,
  OAuth2ProviderConfig,
  OAuth2ProviderClient,
  OAuth2Tokens,
  OAuth2Profile,
} from '../../../src/providers/oauth2.provider.js';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Logger } from '@maroonedsoftware/logger';
import type { CacheProvider } from '@maroonedsoftware/cache';
import type { PolicyResult, PolicyService } from '@maroonedsoftware/policies';

const TEST_AUTHORIZE_URL = new URL('https://github.com/login/oauth/authorize');

const makeCache = () => {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    update: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
      return key;
    }),
    _store: store,
  } as unknown as CacheProvider & { _store: Map<string, string> };
};

const makeRepo = () =>
  ({
    createFactor: vi.fn(async (actorId: string, value: OAuth2FactorValue) => ({
      id: 'factor-new',
      actorId,
      active: true,
      ...value,
    })),
    findFactor: vi.fn(async () => undefined),
    lookupFactor: vi.fn(async () => undefined),
    lookupFactorsByEmail: vi.fn(async () => []),
    getFactor: vi.fn(),
    listFactors: vi.fn(async () => []),
    updateRefreshToken: vi.fn(async () => undefined),
    updateEmail: vi.fn(async () => undefined),
    deleteFactor: vi.fn(async () => undefined),
  }) as unknown as OAuth2FactorRepository;

const makeEmailLookup = () =>
  ({
    findActorByEmail: vi.fn(async () => undefined),
  }) as unknown as OAuth2ActorEmailLookup;

const makePolicyService = (result: PolicyResult = { allowed: true }) =>
  ({
    check: vi.fn(async () => result),
    assert: vi.fn(async () => undefined),
  }) as unknown as PolicyService;

const makeLogger = () =>
  ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const makeClient = (overrides: Partial<OAuth2ProviderClient> = {}): OAuth2ProviderClient => ({
  createAuthorizationURL: vi.fn(() => TEST_AUTHORIZE_URL),
  validateAuthorizationCode: vi.fn(async (): Promise<OAuth2Tokens> => ({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: new Date(Date.now() + 3600_000),
  })),
  refreshAccessToken: vi.fn(async (): Promise<OAuth2Tokens> => ({
    accessToken: 'new-access',
    refreshToken: 'rotated-refresh',
    expiresAt: new Date(Date.now() + 3600_000),
  })),
  ...overrides,
});

const makeProviderConfig = (overrides: Partial<OAuth2ProviderConfig> = {}): OAuth2ProviderConfig => ({
  name: 'github',
  client: makeClient(),
  scopes: ['read:user', 'user:email'],
  usesPKCE: false,
  fetchProfile: vi.fn(
    async (): Promise<Omit<OAuth2Profile, 'provider'>> => ({
      subject: 'gh-12345',
      email: 'octocat@example.com',
      emailVerified: true,
      name: 'The Octocat',
      rawProfile: { id: 12345, login: 'octocat' },
    }),
  ),
  ...overrides,
});

const makeService = (
  config: OAuth2ProviderConfig,
  repo: OAuth2FactorRepository,
  lookup: OAuth2ActorEmailLookup,
  cache: CacheProvider,
  policyService: PolicyService = makePolicyService(),
) => {
  const registry = new OAuth2ProviderRegistry(new OAuth2ProviderRegistryConfig([config]));
  const encryption = new EncryptionProvider(crypto.randomBytes(32));
  return {
    service: new OAuth2FactorService(new OAuth2FactorServiceOptions(), registry, repo, lookup, cache, encryption, makeLogger(), policyService),
    encryption,
    registry,
    policyService,
  };
};

describe('OAuth2FactorService', () => {
  let cache: ReturnType<typeof makeCache>;
  let repo: ReturnType<typeof makeRepo>;
  let emailLookup: ReturnType<typeof makeEmailLookup>;
  let providerConfig: OAuth2ProviderConfig;
  let service: OAuth2FactorService;
  let encryption: EncryptionProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCache();
    repo = makeRepo();
    emailLookup = makeEmailLookup();
    providerConfig = makeProviderConfig();
    ({ service, encryption } = makeService(providerConfig, repo, emailLookup, cache));
  });

  describe('beginAuthorization', () => {
    it('throws 400 when intent=link without actorId', async () => {
      await expect(service.beginAuthorization({ provider: 'github', intent: 'link' })).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('throws 404 for an unknown provider', async () => {
      await expect(service.beginAuthorization({ provider: 'nope', intent: 'sign-in' })).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('returns the authorize URL and caches state without a code verifier when usesPKCE=false', async () => {
      const result = await service.beginAuthorization({ provider: 'github', intent: 'sign-in' });

      expect(result.url).toBe(TEST_AUTHORIZE_URL);
      expect(providerConfig.client.createAuthorizationURL).toHaveBeenCalledWith(result.state, null, providerConfig.scopes);

      const stored = JSON.parse(cache._store.get(`oauth2_state_${result.state}`)!);
      expect(stored.codeVerifier).toBeNull();
    });

    it('passes a code verifier to the adapter when usesPKCE=true', async () => {
      providerConfig = makeProviderConfig({ usesPKCE: true });
      ({ service } = makeService(providerConfig, repo, emailLookup, cache));

      await service.beginAuthorization({ provider: 'github', intent: 'sign-in' });

      const [, verifier] = vi.mocked(providerConfig.client.createAuthorizationURL).mock.calls[0]!;
      expect(typeof verifier).toBe('string');
      expect((verifier as string).length).toBeGreaterThan(0);
    });
  });

  describe('completeAuthorization', () => {
    const seed = async () => {
      const { state } = await service.beginAuthorization({ provider: 'github', intent: 'sign-in' });
      return state;
    };

    it('throws 400 when state is missing from the callback', async () => {
      await expect(service.completeAuthorization({ params: { code: 'abc' } })).rejects.toMatchObject({
        statusCode: 400,
        details: { state: 'missing from callback' },
      });
    });

    it('throws 400 when code is missing from the callback', async () => {
      const state = await seed();
      await expect(service.completeAuthorization({ params: { state } })).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'missing from callback' },
      });
    });

    it('throws 400 when the IdP returned an error response', async () => {
      await expect(
        service.completeAuthorization({
          params: { error: 'access_denied', error_description: 'user said no', error_uri: 'https://example.com/oauth-errors#denied' },
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        details: {
          error: 'access_denied',
          error_description: 'user said no',
          error_uri: 'https://example.com/oauth-errors#denied',
        },
      });
    });

    it('throws 404 when the state has expired', async () => {
      await expect(
        service.completeAuthorization({ params: { code: 'abc', state: 'missing' } }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 502 when fetchProfile throws', async () => {
      const state = await seed();
      vi.mocked(providerConfig.fetchProfile).mockRejectedValueOnce(new Error('network down'));

      await expect(
        service.completeAuthorization({ params: { code: 'abc', state } }),
      ).rejects.toMatchObject({ statusCode: 502 });
    });

    it('returns signed-in for a known (provider, subject)', async () => {
      const state = await seed();
      const existing: OAuth2Factor = {
        id: 'factor-1',
        actorId: 'actor-1',
        active: true,
        provider: 'github',
        subject: 'gh-12345',
        email: 'octocat@example.com',
      };
      vi.mocked(repo.findFactor).mockResolvedValue(existing);

      const result = await service.completeAuthorization({ params: { code: 'abc', state } });

      expect(result.kind).toBe('signed-in');
      if (result.kind !== 'signed-in') throw new Error('unreachable');
      expect(result.actorId).toBe('actor-1');
    });

    it('persists a refresh token on signed-in when persistRefreshToken=true', async () => {
      providerConfig = makeProviderConfig({ persistRefreshToken: true });
      ({ service, encryption } = makeService(providerConfig, repo, emailLookup, cache));

      const { state } = await service.beginAuthorization({ provider: 'github', intent: 'sign-in' });
      vi.mocked(repo.findFactor).mockResolvedValue({
        id: 'factor-1',
        actorId: 'actor-1',
        active: true,
        provider: 'github',
        subject: 'gh-12345',
      });

      await service.completeAuthorization({ params: { code: 'abc', state } });

      const args = vi.mocked(repo.updateRefreshToken).mock.calls[0]![1];
      expect(encryption.decryptWithDek(args.encryptedRefreshToken, args.encryptedRefreshTokenDek)).toBe('refresh-token');
    });

    it('returns linked when intent=link', async () => {
      const { state } = await service.beginAuthorization({ provider: 'github', intent: 'link', actorId: 'actor-existing' });

      const result = await service.completeAuthorization({ params: { code: 'abc', state } });

      expect(result.kind).toBe('linked');
      if (result.kind !== 'linked') throw new Error('unreachable');
      expect(result.actorId).toBe('actor-existing');
    });

    it('auto-links on verified email match', async () => {
      const state = await seed();
      vi.mocked(emailLookup.findActorByEmail).mockResolvedValue('actor-by-email');

      const result = await service.completeAuthorization({ params: { code: 'abc', state } });

      expect(result.kind).toBe('linked');
      if (result.kind !== 'linked') throw new Error('unreachable');
      expect(result.actorId).toBe('actor-by-email');
    });

    it('returns new-user with emailConflict when email matches but is unverified', async () => {
      providerConfig = makeProviderConfig({
        fetchProfile: vi.fn(async () => ({
          subject: 'gh-12345',
          email: 'octocat@example.com',
          emailVerified: false,
          rawProfile: {},
        })),
      });
      ({ service } = makeService(providerConfig, repo, emailLookup, cache));
      const state = await seed();
      vi.mocked(emailLookup.findActorByEmail).mockResolvedValue('actor-by-email');

      const result = await service.completeAuthorization({ params: { code: 'abc', state } });

      expect(result.kind).toBe('new-user');
      if (result.kind !== 'new-user') throw new Error('unreachable');
      expect(result.emailConflict).toEqual({ actorId: 'actor-by-email', reason: 'unverified-email' });
    });

    it('returns new-user with no conflict when nothing matches', async () => {
      providerConfig = makeProviderConfig({
        fetchProfile: vi.fn(async () => ({ subject: 'gh-99', email: 'fresh@example.com', emailVerified: true, rawProfile: {} })),
      });
      ({ service } = makeService(providerConfig, repo, emailLookup, cache));
      const state = await seed();

      const result = await service.completeAuthorization({ params: { code: 'abc', state } });

      expect(result.kind).toBe('new-user');
      if (result.kind !== 'new-user') throw new Error('unreachable');
      expect(result.emailConflict).toBeUndefined();
    });

    it('throws 403 when the oauth2.profile.allowed policy denies the profile', async () => {
      const policyService = makePolicyService({ allowed: false, reason: 'org_required' });
      ({ service } = makeService(providerConfig, repo, emailLookup, cache, policyService));
      const { state } = await service.beginAuthorization({ provider: 'github', intent: 'sign-in' });

      await expect(service.completeAuthorization({ params: { code: 'abc', state } })).rejects.toMatchObject({
        statusCode: 403,
        details: { profile: 'not allowed' },
      });
      expect(policyService.check).toHaveBeenCalledWith('auth.factor.oauth2.profile.allowed', { profile: expect.objectContaining({ provider: 'github' }) });
    });
  });

  describe('createFactorFromAuthorization', () => {
    it('throws 404 when the authorization id is unknown', async () => {
      await expect(service.createFactorFromAuthorization('actor-1', 'missing')).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('persists the factor and clears the cache', async () => {
      providerConfig = makeProviderConfig({
        fetchProfile: vi.fn(async () => ({ subject: 'gh-99', email: 'fresh@example.com', emailVerified: true, rawProfile: {} })),
      });
      ({ service } = makeService(providerConfig, repo, emailLookup, cache));
      const { state } = await service.beginAuthorization({ provider: 'github', intent: 'sign-in' });
      const result = await service.completeAuthorization({ params: { code: 'abc', state } });
      if (result.kind !== 'new-user') throw new Error('expected new-user');

      const factor = await service.createFactorFromAuthorization('actor-fresh', result.authorizationId);

      expect(factor.actorId).toBe('actor-fresh');
      expect(cache._store.has(`oauth2_authorization_${result.authorizationId}`)).toBe(false);
    });
  });

  describe('refreshAccessToken', () => {
    it('throws 404 when the factor has no refresh token', async () => {
      vi.mocked(repo.getFactor).mockResolvedValue({
        id: 'f',
        actorId: 'a',
        active: true,
        provider: 'github',
        subject: 's',
      });

      await expect(service.refreshAccessToken('a', 'f')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 400 when the adapter does not implement refresh', async () => {
      providerConfig = makeProviderConfig({ client: makeClient({ refreshAccessToken: undefined }) });
      ({ service, encryption } = makeService(providerConfig, repo, emailLookup, cache));

      const { encryptedValue, encryptedDek } = encryption.encryptWithNewDek('refresh-original');
      vi.mocked(repo.getFactor).mockResolvedValue({
        id: 'f',
        actorId: 'a',
        active: true,
        provider: 'github',
        subject: 's',
        encryptedRefreshToken: encryptedValue,
        encryptedRefreshTokenDek: encryptedDek,
      });

      await expect(service.refreshAccessToken('a', 'f')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('decrypts, refreshes, and re-encrypts a rotated refresh token', async () => {
      const { encryptedValue, encryptedDek } = encryption.encryptWithNewDek('refresh-original');
      vi.mocked(repo.getFactor).mockResolvedValue({
        id: 'f',
        actorId: 'a',
        active: true,
        provider: 'github',
        subject: 's',
        encryptedRefreshToken: encryptedValue,
        encryptedRefreshTokenDek: encryptedDek,
      });

      const result = await service.refreshAccessToken('a', 'f');

      expect(result.accessToken).toBe('new-access');
      expect(providerConfig.client.refreshAccessToken).toHaveBeenCalledWith('refresh-original');

      const args = vi.mocked(repo.updateRefreshToken).mock.calls[0]![1];
      expect(encryption.decryptWithDek(args.encryptedRefreshToken, args.encryptedRefreshTokenDek)).toBe('rotated-refresh');
    });

    it('does not re-persist when the refresh token is unchanged', async () => {
      providerConfig = makeProviderConfig({
        client: makeClient({
          refreshAccessToken: vi.fn(async () => ({ accessToken: 'a', refreshToken: 'refresh-original', expiresAt: new Date(Date.now() + 1000) })),
        }),
      });
      ({ service, encryption } = makeService(providerConfig, repo, emailLookup, cache));

      const { encryptedValue, encryptedDek } = encryption.encryptWithNewDek('refresh-original');
      vi.mocked(repo.getFactor).mockResolvedValue({
        id: 'f',
        actorId: 'a',
        active: true,
        provider: 'github',
        subject: 's',
        encryptedRefreshToken: encryptedValue,
        encryptedRefreshTokenDek: encryptedDek,
      });

      await service.refreshAccessToken('a', 'f');

      expect(repo.updateRefreshToken).not.toHaveBeenCalled();
    });
  });
});

describe('OAuth2ProviderRegistry', () => {
  it('throws 404 for an unknown provider', () => {
    const registry = new OAuth2ProviderRegistry(new OAuth2ProviderRegistryConfig([]));
    expect(() => registry.getConfig('unknown')).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });

  it('lists all registered providers', () => {
    const registry = new OAuth2ProviderRegistry(
      new OAuth2ProviderRegistryConfig([makeProviderConfig({ name: 'github' }), makeProviderConfig({ name: 'discord' })]),
    );
    expect(registry.listProviders()).toEqual(['github', 'discord']);
  });
});
