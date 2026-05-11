import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openid-client', () => ({
  None: vi.fn(),
  discovery: vi.fn(),
  randomState: vi.fn(() => 'state-token'),
  randomNonce: vi.fn(() => 'nonce-token'),
  randomPKCECodeVerifier: vi.fn(() => 'code-verifier'),
  calculatePKCECodeChallenge: vi.fn(async () => 'code-challenge'),
  buildAuthorizationUrl: vi.fn(),
  authorizationCodeGrant: vi.fn(),
  refreshTokenGrant: vi.fn(),
  fetchUserInfo: vi.fn(),
}));

import * as openidClient from 'openid-client';
import { OidcFactorService, OidcFactorServiceOptions, OidcActorEmailLookup } from '../../../src/factors/oidc/oidc.factor.service.js';
import { OidcFactorRepository, OidcFactor, OidcFactorValue } from '../../../src/factors/oidc/oidc.factor.repository.js';
import { OidcProviderRegistry, OidcProviderRegistryConfig, OidcProviderConfig } from '../../../src/providers/oidc.provider.js';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Logger } from '@maroonedsoftware/logger';
import type { CacheProvider } from '@maroonedsoftware/cache';
import type { PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { Duration } from 'luxon';
import crypto from 'node:crypto';

const TEST_AUTHORIZE_URL = new URL('https://accounts.example.com/authorize');

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
    createFactor: vi.fn(async (actorId: string, value: OidcFactorValue) => ({
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
  }) as unknown as OidcFactorRepository;

const makeEmailLookup = () =>
  ({
    findActorByEmail: vi.fn(async () => undefined),
  }) as unknown as OidcActorEmailLookup;

const makePolicyService = (result: PolicyResult = { allowed: true }) =>
  ({
    check: vi.fn(async () => result),
    assert: vi.fn(async () => undefined),
  }) as unknown as PolicyService;

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

const makeRegistry = (overrides: Partial<OidcProviderConfig> = {}) =>
  new OidcProviderRegistry(new OidcProviderRegistryConfig([{ ...PROVIDER, ...overrides }]));

const makeService = (
  registry: OidcProviderRegistry,
  repo: OidcFactorRepository,
  emailLookup: OidcActorEmailLookup,
  cache: CacheProvider,
  policyService: PolicyService = makePolicyService(),
) => {
  const encryption = new EncryptionProvider(crypto.randomBytes(32));
  return {
    service: new OidcFactorService(new OidcFactorServiceOptions(), registry, repo, emailLookup, cache, encryption, makeLogger(), policyService),
    encryption,
    policyService,
  };
};

describe('OidcFactorService', () => {
  let cache: ReturnType<typeof makeCache>;
  let repo: ReturnType<typeof makeRepo>;
  let emailLookup: ReturnType<typeof makeEmailLookup>;
  let registry: OidcProviderRegistry;
  let service: OidcFactorService;
  let encryption: EncryptionProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCache();
    repo = makeRepo();
    emailLookup = makeEmailLookup();
    registry = makeRegistry();
    ({ service, encryption } = makeService(registry, repo, emailLookup, cache));

    vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
    vi.mocked(openidClient.buildAuthorizationUrl).mockReturnValue(TEST_AUTHORIZE_URL);
  });

  describe('beginAuthorization', () => {
    it('throws 400 when intent is link without actorId', async () => {
      await expect(service.beginAuthorization({ provider: 'google', intent: 'link' })).rejects.toMatchObject({
        statusCode: 400,
        details: { actorId: 'required when intent is link' },
      });
    });

    it('throws 404 when the provider is not registered', async () => {
      await expect(service.beginAuthorization({ provider: 'unknown', intent: 'sign-in' })).rejects.toMatchObject({
        statusCode: 404,
        details: { provider: 'unknown provider' },
      });
    });

    it('returns the authorize URL and caches the state record', async () => {
      const result = await service.beginAuthorization({ provider: 'google', intent: 'sign-in', redirectAfter: '/welcome' });

      expect(result.url).toBe(TEST_AUTHORIZE_URL);
      expect(result.state).toBe('state-token');

      expect(openidClient.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          redirect_uri: PROVIDER.redirectUri.toString(),
          scope: 'openid profile email',
          state: 'state-token',
          nonce: 'nonce-token',
          code_challenge: 'code-challenge',
          code_challenge_method: 'S256',
        }),
      );

      const stored = JSON.parse(cache._store.get('oidc_state_state-token')!);
      expect(stored).toMatchObject({
        provider: 'google',
        state: 'state-token',
        nonce: 'nonce-token',
        codeVerifier: 'code-verifier',
        intent: 'sign-in',
        redirectAfter: '/welcome',
      });
    });

    it('passes through provider authorizeParams (e.g. Google offline access)', async () => {
      registry = new OidcProviderRegistry(new OidcProviderRegistryConfig([
        { ...PROVIDER, authorizeParams: { access_type: 'offline', prompt: 'consent' } },
      ]));
      ({ service } = makeService(registry, repo, emailLookup, cache));

      await service.beginAuthorization({ provider: 'google', intent: 'sign-in' });

      expect(openidClient.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ access_type: 'offline', prompt: 'consent' }),
      );
    });

    it('defaults to openid+profile+email when scopes is empty', async () => {
      registry = new OidcProviderRegistry(new OidcProviderRegistryConfig([{ ...PROVIDER, scopes: [] }]));
      ({ service } = makeService(registry, repo, emailLookup, cache));

      await service.beginAuthorization({ provider: 'google', intent: 'sign-in' });

      expect(openidClient.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scope: 'openid profile email' }),
      );
    });
  });

  describe('completeAuthorization', () => {
    const seedState = async (overrides: Partial<{ intent: 'sign-in' | 'link'; actorId?: string; redirectAfter?: string }> = {}) => {
      await service.beginAuthorization({ provider: 'google', intent: 'sign-in', ...overrides });
    };

    const seedTokens = (claimsOverrides: Record<string, unknown> = {}, userinfoOverrides: Record<string, unknown> = {}) => {
      const claims = { sub: 'subject-1', email: 'user@example.com', email_verified: true, ...claimsOverrides };
      vi.mocked(openidClient.authorizationCodeGrant).mockResolvedValue({
        access_token: 'access',
        token_type: 'Bearer',
        refresh_token: 'refresh-secret',
        expires_in: 3600,
        scope: 'openid profile email',
        claims: () => claims,
      } as unknown as Awaited<ReturnType<typeof openidClient.authorizationCodeGrant>>);
      vi.mocked(openidClient.fetchUserInfo).mockResolvedValue({ sub: 'subject-1', name: 'User One', ...userinfoOverrides } as openidClient.UserInfoResponse);
    };

    it('throws 400 when the callback params have no state', async () => {
      await expect(service.completeAuthorization({ params: { code: 'xyz' } })).rejects.toMatchObject({
        statusCode: 400,
        details: { state: 'missing from callback' },
      });
    });

    it('throws 400 when the IdP returned an error response', async () => {
      await expect(
        service.completeAuthorization({
          params: { error: 'login_required', error_description: 'session expired' },
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        details: { error: 'login_required', error_description: 'session expired' },
      });
    });

    it('throws 404 when the cached state record has expired', async () => {
      await expect(
        service.completeAuthorization({ params: { code: 'xyz', state: 'missing' } }),
      ).rejects.toMatchObject({
        statusCode: 404,
        details: { state: 'not found or expired' },
      });
    });

    it('throws 400 when iss is supplied but does not match the discovered issuer', async () => {
      await seedState();
      seedTokens();

      await expect(
        service.completeAuthorization({
          params: { code: 'xyz', state: 'state-token', iss: 'https://attacker.example' },
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        details: { iss: 'does not match configured issuer' },
      });
    });

    it('accepts iss when it matches the discovered issuer', async () => {
      await seedState();
      seedTokens();

      const result = await service.completeAuthorization({
        params: { code: 'xyz', state: 'state-token', iss: 'https://accounts.google.com' },
      });

      expect(result.kind).toBe('new-user');
    });

    it('returns signed-in with the existing actor when (provider, subject) is mapped', async () => {
      await seedState();
      seedTokens();
      const existing: OidcFactor = { id: 'factor-1', actorId: 'actor-1', active: true, provider: 'google', subject: 'subject-1', email: 'user@example.com' };
      vi.mocked(repo.findFactor).mockResolvedValue(existing);

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(result.kind).toBe('signed-in');
      if (result.kind !== 'signed-in') throw new Error('unreachable');
      expect(result.actorId).toBe('actor-1');
      expect(result.factorId).toBe('factor-1');
      expect(result.profile.subject).toBe('subject-1');
      expect(result.profile.name).toBe('User One');
    });

    it('persists a rotated refresh token on signed-in when persistRefreshToken=true', async () => {
      registry = new OidcProviderRegistry(new OidcProviderRegistryConfig([{ ...PROVIDER, persistRefreshToken: true }]));
      ({ service, encryption } = makeService(registry, repo, emailLookup, cache));
      vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
      vi.mocked(openidClient.buildAuthorizationUrl).mockReturnValue(TEST_AUTHORIZE_URL);
      await seedState();
      seedTokens();
      const existing: OidcFactor = { id: 'factor-1', actorId: 'actor-1', active: true, provider: 'google', subject: 'subject-1' };
      vi.mocked(repo.findFactor).mockResolvedValue(existing);

      await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(repo.updateRefreshToken).toHaveBeenCalledTimes(1);
      const args = vi.mocked(repo.updateRefreshToken).mock.calls[0]![1];
      expect(args.encryptedRefreshToken).toBeTruthy();
      expect(args.encryptedRefreshTokenDek).toBeTruthy();
      const decrypted = encryption.decryptWithDek(args.encryptedRefreshToken, args.encryptedRefreshTokenDek);
      expect(decrypted).toBe('refresh-secret');
    });

    it('does not persist refresh token when persistRefreshToken is unset', async () => {
      await seedState();
      seedTokens();
      const existing: OidcFactor = { id: 'factor-1', actorId: 'actor-1', active: true, provider: 'google', subject: 'subject-1' };
      vi.mocked(repo.findFactor).mockResolvedValue(existing);

      await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(repo.updateRefreshToken).not.toHaveBeenCalled();
    });

    it('updates the stored email when the IdP reports a different one', async () => {
      await seedState();
      seedTokens({ email: 'new@example.com' });
      const existing: OidcFactor = { id: 'factor-1', actorId: 'actor-1', active: true, provider: 'google', subject: 'subject-1', email: 'old@example.com' };
      vi.mocked(repo.findFactor).mockResolvedValue(existing);

      await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(repo.updateEmail).toHaveBeenCalledWith('factor-1', 'new@example.com');
    });

    it('returns linked and creates a factor when intent=link', async () => {
      await seedState({ intent: 'link', actorId: 'actor-existing' });
      seedTokens();

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(result.kind).toBe('linked');
      if (result.kind !== 'linked') throw new Error('unreachable');
      expect(result.actorId).toBe('actor-existing');
      expect(repo.createFactor).toHaveBeenCalledWith(
        'actor-existing',
        expect.objectContaining({ provider: 'google', subject: 'subject-1', email: 'user@example.com' }),
      );
    });

    it('auto-links and returns linked when sign-in finds a verified-email match', async () => {
      await seedState();
      seedTokens({ email: 'user@example.com', email_verified: true });
      vi.mocked(emailLookup.findActorByEmail).mockResolvedValue('actor-by-email');

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(result.kind).toBe('linked');
      if (result.kind !== 'linked') throw new Error('unreachable');
      expect(result.actorId).toBe('actor-by-email');
      expect(repo.createFactor).toHaveBeenCalledWith('actor-by-email', expect.anything());
    });

    it('does NOT auto-link when the email is unverified — returns new-user with emailConflict', async () => {
      await seedState();
      seedTokens({ email: 'user@example.com', email_verified: false });
      vi.mocked(emailLookup.findActorByEmail).mockResolvedValue('actor-by-email');

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(result.kind).toBe('new-user');
      if (result.kind !== 'new-user') throw new Error('unreachable');
      expect(result.emailConflict).toEqual({ actorId: 'actor-by-email', reason: 'unverified-email' });
      expect(repo.createFactor).not.toHaveBeenCalled();
    });

    it('returns new-user with no conflict when email is verified but no actor matches', async () => {
      await seedState();
      seedTokens({ email: 'fresh@example.com', email_verified: true });

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(result.kind).toBe('new-user');
      if (result.kind !== 'new-user') throw new Error('unreachable');
      expect(result.emailConflict).toBeUndefined();
      expect(result.authorizationId).toBeTruthy();
      expect(repo.createFactor).not.toHaveBeenCalled();
    });

    it('caches the pending authorization under authorizationId for new-user resolution', async () => {
      await seedState();
      seedTokens({ email: 'fresh@example.com', email_verified: true });

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });
      if (result.kind !== 'new-user') throw new Error('unreachable');

      const cached = JSON.parse(cache._store.get(`oidc_authorization_${result.authorizationId}`)!);
      expect(cached.profile.subject).toBe('subject-1');
      expect(cached.profile.email).toBe('fresh@example.com');
    });

    it('deletes the cached state record after a successful exchange', async () => {
      await seedState();
      seedTokens();

      await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(cache._store.has('oidc_state_state-token')).toBe(false);
    });

    it('continues with id_token claims when /userinfo fetch fails', async () => {
      await seedState();
      seedTokens();
      vi.mocked(openidClient.fetchUserInfo).mockRejectedValue(new Error('userinfo down'));

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(result.kind).toBe('new-user');
    });

    it('throws 403 when the oidc.profile.allowed policy denies the profile', async () => {
      const policyService = makePolicyService({ allowed: false, reason: 'hd_required' });
      ({ service } = makeService(registry, repo, emailLookup, cache, policyService));
      await seedState();
      seedTokens();

      await expect(
        service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } }),
      ).rejects.toMatchObject({ statusCode: 403, details: { profile: 'not allowed' } });
      expect(policyService.check).toHaveBeenCalledWith(
        'oidc.profile.allowed',
        { profile: expect.objectContaining({ provider: 'google', subject: 'subject-1' }) },
      );
    });
  });

  describe('createFactorFromAuthorization', () => {
    it('throws 404 when the authorization id has expired', async () => {
      await expect(service.createFactorFromAuthorization('actor-1', 'missing')).rejects.toMatchObject({
        statusCode: 404,
        details: { authorizationId: 'not found or expired' },
      });
    });

    it('persists the factor and deletes the cached pending authorization', async () => {
      await service.beginAuthorization({ provider: 'google', intent: 'sign-in' });
      vi.mocked(openidClient.authorizationCodeGrant).mockResolvedValue({
        access_token: 'access',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email',
        claims: () => ({ sub: 'subject-1', email: 'fresh@example.com', email_verified: true }),
      } as unknown as Awaited<ReturnType<typeof openidClient.authorizationCodeGrant>>);
      vi.mocked(openidClient.fetchUserInfo).mockResolvedValue({ sub: 'subject-1' } as openidClient.UserInfoResponse);
      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });
      if (result.kind !== 'new-user') throw new Error('expected new-user');

      const factor = await service.createFactorFromAuthorization('actor-fresh', result.authorizationId);

      expect(factor.actorId).toBe('actor-fresh');
      expect(repo.createFactor).toHaveBeenCalledWith(
        'actor-fresh',
        expect.objectContaining({ provider: 'google', subject: 'subject-1', email: 'fresh@example.com' }),
      );
      expect(cache._store.has(`oidc_authorization_${result.authorizationId}`)).toBe(false);
    });
  });

  describe('refreshAccessToken', () => {
    it('throws 404 when the factor has no persisted refresh token', async () => {
      vi.mocked(repo.getFactor).mockResolvedValue({ id: 'f', actorId: 'a', active: true, provider: 'google', subject: 's' });

      await expect(service.refreshAccessToken('a', 'f')).rejects.toMatchObject({
        statusCode: 404,
        details: { refreshToken: 'no refresh token persisted for factor' },
      });
    });

    it('decrypts the stored refresh token, calls the IdP, and re-encrypts a rotated token', async () => {
      const { encryptedValue, encryptedDek } = encryption.encryptWithNewDek('refresh-original');
      vi.mocked(repo.getFactor).mockResolvedValue({
        id: 'f',
        actorId: 'a',
        active: true,
        provider: 'google',
        subject: 's',
        encryptedRefreshToken: encryptedValue,
        encryptedRefreshTokenDek: encryptedDek,
      });
      vi.mocked(openidClient.refreshTokenGrant).mockResolvedValue({
        access_token: 'new-access',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rotated-refresh',
        scope: 'openid profile',
      } as unknown as Awaited<ReturnType<typeof openidClient.refreshTokenGrant>>);

      const result = await service.refreshAccessToken('a', 'f');

      expect(result.accessToken).toBe('new-access');
      expect(openidClient.refreshTokenGrant).toHaveBeenCalledWith(expect.anything(), 'refresh-original');

      expect(repo.updateRefreshToken).toHaveBeenCalledTimes(1);
      const args = vi.mocked(repo.updateRefreshToken).mock.calls[0]![1];
      expect(encryption.decryptWithDek(args.encryptedRefreshToken, args.encryptedRefreshTokenDek)).toBe('rotated-refresh');
    });

    it('does not re-persist when the IdP returns the same refresh token', async () => {
      const { encryptedValue, encryptedDek } = encryption.encryptWithNewDek('refresh-original');
      vi.mocked(repo.getFactor).mockResolvedValue({
        id: 'f',
        actorId: 'a',
        active: true,
        provider: 'google',
        subject: 's',
        encryptedRefreshToken: encryptedValue,
        encryptedRefreshTokenDek: encryptedDek,
      });
      vi.mocked(openidClient.refreshTokenGrant).mockResolvedValue({
        access_token: 'new-access',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-original',
      } as unknown as Awaited<ReturnType<typeof openidClient.refreshTokenGrant>>);

      await service.refreshAccessToken('a', 'f');

      expect(repo.updateRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('hasPendingAuthorization', () => {
    it('returns true when an authorization is cached', async () => {
      await service.beginAuthorization({ provider: 'google', intent: 'sign-in' });
      vi.mocked(openidClient.authorizationCodeGrant).mockResolvedValue({
        access_token: 'access',
        token_type: 'Bearer',
        expires_in: 3600,
        claims: () => ({ sub: 'subject-1' }),
      } as unknown as Awaited<ReturnType<typeof openidClient.authorizationCodeGrant>>);
      vi.mocked(openidClient.fetchUserInfo).mockResolvedValue({ sub: 'subject-1' } as openidClient.UserInfoResponse);
      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });
      if (result.kind !== 'new-user') throw new Error('expected new-user');

      await expect(service.hasPendingAuthorization(result.authorizationId)).resolves.toBe(true);
    });

    it('returns false when the authorization is not cached', async () => {
      await expect(service.hasPendingAuthorization('missing')).resolves.toBe(false);
    });
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

  it('drops a rejected discovery promise from the cache so it can be retried', async () => {
    vi.mocked(openidClient.discovery).mockRejectedValueOnce(new Error('boom'));
    const registry = makeRegistry();

    await expect(registry.getConfiguration('google')).rejects.toThrow('boom');

    vi.mocked(openidClient.discovery).mockResolvedValueOnce({} as openidClient.Configuration);
    await expect(registry.getConfiguration('google')).resolves.toBeDefined();
    expect(openidClient.discovery).toHaveBeenCalledTimes(2);
  });

  it('reports public clients when clientSecret is omitted', () => {
    const registry = new OidcProviderRegistry(
      new OidcProviderRegistryConfig([{ ...PROVIDER, clientSecret: undefined }]),
    );
    expect(registry.isPublicClient('google')).toBe(true);
  });

  it('uses None client authentication for public clients', async () => {
    const noneStub = vi.fn();
    vi.mocked(openidClient.None).mockImplementation(noneStub as never);
    vi.mocked(openidClient.discovery).mockResolvedValue(makeConfiguration());
    const registry = new OidcProviderRegistry(
      new OidcProviderRegistryConfig([{ ...PROVIDER, clientSecret: undefined }]),
    );

    await registry.getConfiguration('google');

    expect(openidClient.None).toHaveBeenCalled();
  });

  it('throws 404 for an unknown provider', () => {
    const registry = makeRegistry();
    expect(() => registry.getConfig('unknown')).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });
});
