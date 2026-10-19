import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openid-client', () => ({
  None: vi.fn(),
  discovery: vi.fn(),
  allowInsecureRequests: vi.fn(),
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
import { AuditRecorder } from '../../../src/audit/audit.recorder.js';
import type { AuditSink } from '../../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../../src/audit/audit.event.js';
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
    updatePicture: vi.fn(async () => undefined),
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

const makeRegistry = (overrides: Partial<OidcProviderConfig> = {}, logger: Logger = makeLogger()) =>
  new OidcProviderRegistry(new OidcProviderRegistryConfig([{ ...PROVIDER, ...overrides }]), logger);

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
      registry = new OidcProviderRegistry(
        new OidcProviderRegistryConfig([{ ...PROVIDER, authorizeParams: { access_type: 'offline', prompt: 'consent' } }]),
        makeLogger(),
      );
      ({ service } = makeService(registry, repo, emailLookup, cache));

      await service.beginAuthorization({ provider: 'google', intent: 'sign-in' });

      expect(openidClient.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ access_type: 'offline', prompt: 'consent' }),
      );
    });

    it('defaults to openid+profile+email when scopes is empty', async () => {
      registry = new OidcProviderRegistry(new OidcProviderRegistryConfig([{ ...PROVIDER, scopes: [] }]), makeLogger());
      ({ service } = makeService(registry, repo, emailLookup, cache));

      await service.beginAuthorization({ provider: 'google', intent: 'sign-in' });

      expect(openidClient.buildAuthorizationUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: 'openid profile email' }));
    });

    it('throws 400 when intent is step-up without actorId', async () => {
      await expect(service.beginAuthorization({ provider: 'google', intent: 'step-up' })).rejects.toMatchObject({
        statusCode: 400,
        details: { actorId: 'required when intent is step-up' },
      });
    });

    it('merges per-request authorizeParams over the provider ones', async () => {
      registry = makeRegistry({ authorizeParams: { access_type: 'offline', prompt: 'consent' } });
      ({ service } = makeService(registry, repo, emailLookup, cache));

      await service.beginAuthorization({
        provider: 'google',
        intent: 'sign-in',
        authorizeParams: { login_hint: 'user@acme.example', prompt: 'login', max_age: 0, acr_values: 'phr' },
      });

      expect(openidClient.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ access_type: 'offline', prompt: 'login', login_hint: 'user@acme.example', max_age: '0', acr_values: 'phr' }),
      );
      expect(JSON.parse(cache._store.get('oidc_state_state-token')!)).toMatchObject({ maxAge: 0 });
    });

    it('does not let per-request params override the protocol parameters', async () => {
      await service.beginAuthorization({
        provider: 'google',
        intent: 'sign-in',
        authorizeParams: { state: 'attacker', nonce: 'attacker' } as unknown as Parameters<
          OidcFactorService['beginAuthorization']
        >[0]['authorizeParams'],
      });

      expect(openidClient.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ state: 'state-token', nonce: 'nonce-token' }),
      );
    });

    it('stores no maxAge when max_age was not requested', async () => {
      await service.beginAuthorization({ provider: 'google', intent: 'sign-in', authorizeParams: { login_hint: 'user@acme.example' } });

      expect(JSON.parse(cache._store.get('oidc_state_state-token')!)).not.toHaveProperty('maxAge');
    });

    it.each([-1, 1.5, Number.NaN])('throws 400 for max_age %s', async maxAge => {
      await expect(service.beginAuthorization({ provider: 'google', intent: 'sign-in', authorizeParams: { max_age: maxAge } })).rejects.toMatchObject(
        {
          statusCode: 400,
          details: { max_age: 'must be a non-negative integer' },
        },
      );
      expect(cache.set).not.toHaveBeenCalled();
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
      vi.mocked(openidClient.fetchUserInfo).mockResolvedValue({
        sub: 'subject-1',
        name: 'User One',
        picture: 'https://cdn.example/avatar.png',
        ...userinfoOverrides,
      } as openidClient.UserInfoResponse);
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
      await expect(service.completeAuthorization({ params: { code: 'xyz', state: 'missing' } })).rejects.toMatchObject({
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
      const existing: OidcFactor = {
        id: 'factor-1',
        actorId: 'actor-1',
        active: true,
        provider: 'google',
        subject: 'subject-1',
        email: 'user@example.com',
      };
      vi.mocked(repo.findFactor).mockResolvedValue(existing);

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(result.kind).toBe('signed-in');
      if (result.kind !== 'signed-in') throw new Error('unreachable');
      expect(result.intent).toBe('sign-in');
      expect(result.actorId).toBe('actor-1');
      expect(result.factorId).toBe('factor-1');
      expect(result.profile.subject).toBe('subject-1');
      expect(result.profile.name).toBe('User One');
    });

    it('persists a rotated refresh token on signed-in when persistRefreshToken=true', async () => {
      registry = new OidcProviderRegistry(new OidcProviderRegistryConfig([{ ...PROVIDER, persistRefreshToken: true }]), makeLogger());
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
      const existing: OidcFactor = {
        id: 'factor-1',
        actorId: 'actor-1',
        active: true,
        provider: 'google',
        subject: 'subject-1',
        email: 'old@example.com',
      };
      vi.mocked(repo.findFactor).mockResolvedValue(existing);

      await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(repo.updateEmail).toHaveBeenCalledWith('factor-1', 'new@example.com');
    });

    it('updates the stored picture when the IdP reports a different one', async () => {
      await seedState();
      seedTokens({}, { picture: 'https://cdn.example/avatar-new.png' });
      const existing: OidcFactor = {
        id: 'factor-1',
        actorId: 'actor-1',
        active: true,
        provider: 'google',
        subject: 'subject-1',
        picture: 'https://cdn.example/avatar-old.png',
      };
      vi.mocked(repo.findFactor).mockResolvedValue(existing);

      await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(repo.updatePicture).toHaveBeenCalledWith('factor-1', 'https://cdn.example/avatar-new.png');
    });

    it('does not update the stored picture when it is unchanged', async () => {
      await seedState();
      seedTokens();
      const existing: OidcFactor = {
        id: 'factor-1',
        actorId: 'actor-1',
        active: true,
        provider: 'google',
        subject: 'subject-1',
        picture: 'https://cdn.example/avatar.png',
      };
      vi.mocked(repo.findFactor).mockResolvedValue(existing);

      await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(repo.updatePicture).not.toHaveBeenCalled();
    });

    it('returns linked and creates a factor when intent=link', async () => {
      await seedState({ intent: 'link', actorId: 'actor-existing' });
      seedTokens();

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(result.kind).toBe('linked');
      if (result.kind !== 'linked') throw new Error('unreachable');
      expect(result.intent).toBe('link');
      expect(result.actorId).toBe('actor-existing');
      expect(repo.createFactor).toHaveBeenCalledWith(
        'actor-existing',
        expect.objectContaining({ provider: 'google', subject: 'subject-1', email: 'user@example.com', picture: 'https://cdn.example/avatar.png' }),
      );
    });

    it('refuses a link whose (provider, subject) belongs to another actor, with a 409 and an audit record', async () => {
      const events: AuthenticationAuditEvent[] = [];
      const recorder = new AuditRecorder({ record: (event: AuthenticationAuditEvent) => void events.push(event) } as unknown as AuditSink);
      const linking = new OidcFactorService(
        new OidcFactorServiceOptions(),
        registry,
        repo,
        emailLookup,
        cache,
        encryption,
        makeLogger(),
        makePolicyService(),
        recorder,
      );
      await linking.beginAuthorization({ provider: 'google', intent: 'link', actorId: 'actor-linking' });
      seedTokens();
      vi.mocked(repo.findFactor).mockResolvedValue({
        id: 'factor-stranger',
        actorId: 'actor-stranger',
        active: true,
        provider: 'google',
        subject: 'subject-1',
        email: 'old@example.com',
      });

      await expect(linking.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } })).rejects.toMatchObject({
        statusCode: 409,
        details: { provider: 'already linked to another account' },
      });

      // Nothing about the stranger's factor is touched, and no session-worthy result escapes.
      expect(repo.updateRefreshToken).not.toHaveBeenCalled();
      expect(repo.updateEmail).not.toHaveBeenCalled();
      expect(repo.updatePicture).not.toHaveBeenCalled();
      expect(repo.createFactor).not.toHaveBeenCalled();
      expect(events.filter(event => event.type === 'oidc.signed_in')).toEqual([]);
      expect(events.find(event => event.type === 'oidc.link.rejected')).toMatchObject({
        category: 'privilege',
        outcome: 'failure',
        actorId: 'actor-linking',
        data: { provider: 'google', subject: 'subject-1', reason: 'subject_taken' },
      });
    });

    it('answers signed-in with the link intent when the identity is already on the linking actor', async () => {
      await seedState({ intent: 'link', actorId: 'actor-1' });
      seedTokens();
      vi.mocked(repo.findFactor).mockResolvedValue({
        id: 'factor-1',
        actorId: 'actor-1',
        active: true,
        provider: 'google',
        subject: 'subject-1',
        email: 'user@example.com',
      });

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(result).toMatchObject({ kind: 'signed-in', intent: 'link', actorId: 'actor-1', factorId: 'factor-1' });
      expect(repo.createFactor).not.toHaveBeenCalled();
    });

    it('auto-links and returns linked when sign-in finds a verified-email match', async () => {
      await seedState();
      seedTokens({ email: 'user@example.com', email_verified: true });
      vi.mocked(emailLookup.findActorByEmail).mockResolvedValue('actor-by-email');

      const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

      expect(result.kind).toBe('linked');
      if (result.kind !== 'linked') throw new Error('unreachable');
      expect(result.intent).toBe('sign-in');
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
      expect(result.intent).toBe('sign-in');
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

      await expect(service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } })).rejects.toMatchObject({
        statusCode: 403,
        details: { profile: 'not allowed' },
      });
      expect(policyService.check).toHaveBeenCalledWith('auth.factor.oidc.profile.allowed', {
        profile: expect.objectContaining({ provider: 'google', subject: 'subject-1' }),
      });
    });

    describe('provider trustEmail', () => {
      const makeTrusting = (trustEmail: OidcProviderConfig['trustEmail']) => {
        const events: AuthenticationAuditEvent[] = [];
        const recorder = new AuditRecorder({ record: (event: AuthenticationAuditEvent) => void events.push(event) } as unknown as AuditSink);
        const trusting = new OidcFactorService(
          new OidcFactorServiceOptions(),
          makeRegistry({ trustEmail }),
          repo,
          emailLookup,
          cache,
          encryption,
          makeLogger(),
          makePolicyService(),
          recorder,
        );
        return { trusting, events };
      };

      it('auto-links an unverified address the provider vouches for, and records that it vouched', async () => {
        const trustEmail = vi.fn(async () => true);
        const { trusting, events } = makeTrusting(trustEmail);
        await trusting.beginAuthorization({ provider: 'google', intent: 'sign-in' });
        seedTokens({ email: 'user@example.com', email_verified: undefined });
        vi.mocked(emailLookup.findActorByEmail).mockResolvedValue('actor-by-email');

        const result = await trusting.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        expect(result).toMatchObject({ kind: 'linked', intent: 'sign-in', actorId: 'actor-by-email' });
        expect(trustEmail).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google', subject: 'subject-1', email: 'user@example.com' }));
        expect(repo.createFactor).toHaveBeenCalledWith('actor-by-email', expect.anything());
        expect(events.find(event => event.type === 'oidc.linked.auto')).toMatchObject({
          actorId: 'actor-by-email',
          data: { provider: 'google', subject: 'subject-1', email: 'user@example.com', emailTrust: 'provider' },
        });
      });

      it('refuses a verified address the provider declines, surfacing the conflict as today', async () => {
        const { trusting, events } = makeTrusting(() => false);
        await trusting.beginAuthorization({ provider: 'google', intent: 'sign-in' });
        seedTokens({ email: 'user@example.com', email_verified: true });
        vi.mocked(emailLookup.findActorByEmail).mockResolvedValue('actor-by-email');

        const result = await trusting.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        expect(result.kind).toBe('new-user');
        if (result.kind !== 'new-user') throw new Error('unreachable');
        expect(result.emailConflict).toEqual({ actorId: 'actor-by-email', reason: 'unverified-email' });
        expect(repo.createFactor).not.toHaveBeenCalled();
        expect(events.filter(event => event.type === 'oidc.linked.auto')).toEqual([]);
        expect(events.find(event => event.type === 'oidc.link.rejected')).toMatchObject({
          actorId: 'actor-by-email',
          data: { provider: 'google', subject: 'subject-1', reason: 'unverified_email', emailTrust: 'provider' },
        });
      });

      it('keeps the email_verified rule when the provider has no hook, and records that rule', async () => {
        const { trusting, events } = makeTrusting(undefined);
        await trusting.beginAuthorization({ provider: 'google', intent: 'sign-in' });
        seedTokens({ email: 'user@example.com', email_verified: undefined });
        vi.mocked(emailLookup.findActorByEmail).mockResolvedValue('actor-by-email');

        const result = await trusting.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        expect(result).toMatchObject({ kind: 'new-user', emailConflict: { actorId: 'actor-by-email', reason: 'unverified-email' } });
        expect(repo.createFactor).not.toHaveBeenCalled();
        expect(events.find(event => event.type === 'oidc.link.rejected')).toMatchObject({
          data: { reason: 'unverified_email', emailTrust: 'email_verified' },
        });
      });

      it('fails the authorization when the hook throws, linking and staging nothing', async () => {
        const { trusting, events } = makeTrusting(async () => {
          throw new Error('domain lookup failed');
        });
        await trusting.beginAuthorization({ provider: 'google', intent: 'sign-in' });
        seedTokens({ email: 'user@example.com', email_verified: true });
        vi.mocked(emailLookup.findActorByEmail).mockResolvedValue('actor-by-email');

        await expect(trusting.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } })).rejects.toThrow('domain lookup failed');

        expect(repo.createFactor).not.toHaveBeenCalled();
        expect(cache.set).toHaveBeenCalledTimes(1); // the state record only, no pending authorization
        expect(events.filter(event => event.type === 'oidc.linked.auto' || event.type === 'oidc.new_user')).toEqual([]);
      });

      it('is not asked when (provider, subject) already has a factor', async () => {
        const trustEmail = vi.fn(() => false);
        const { trusting } = makeTrusting(trustEmail);
        await trusting.beginAuthorization({ provider: 'google', intent: 'sign-in' });
        seedTokens();
        vi.mocked(repo.findFactor).mockResolvedValue({
          id: 'factor-1',
          actorId: 'actor-1',
          active: true,
          provider: 'google',
          subject: 'subject-1',
          email: 'user@example.com',
        });

        const result = await trusting.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        expect(result).toMatchObject({ kind: 'signed-in', actorId: 'actor-1' });
        expect(trustEmail).not.toHaveBeenCalled();
      });
    });

    describe('authentication claims', () => {
      it('types amr, acr and auth_time from the merged claims', async () => {
        await seedState();
        seedTokens({ amr: ['pwd', 'mfa', 7], acr: 'urn:mace:incommon:iap:silver', auth_time: 1_760_000_000 });

        const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        expect(result.profile.amr).toEqual(['pwd', 'mfa']);
        expect(result.profile.acr).toBe('urn:mace:incommon:iap:silver');
        expect(result.profile.authTime?.toSeconds()).toBe(1_760_000_000);
        expect(result.profile.authTime?.zoneName).toBe('UTC');
      });

      it('lets userinfo override the id_token claims', async () => {
        await seedState();
        seedTokens({ acr: 'id-token-acr' }, { acr: 'userinfo-acr' });

        const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        expect(result.profile.acr).toBe('userinfo-acr');
      });

      it('leaves the claims undefined when the IdP sends none or malformed ones', async () => {
        await seedState();
        seedTokens({ amr: 'pwd', acr: 3, auth_time: '1760000000' });

        const result = await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        expect(result.profile.amr).toBeUndefined();
        expect(result.profile.acr).toBeUndefined();
        expect(result.profile.authTime).toBeUndefined();
      });
    });

    describe('max_age enforcement', () => {
      it('passes no maxAge to the code grant when max_age was not requested', async () => {
        await seedState();
        seedTokens();

        await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        const checks = vi.mocked(openidClient.authorizationCodeGrant).mock.calls[0]![2];
        expect(checks).not.toHaveProperty('maxAge');
      });

      it('passes the requested max_age to the code grant so auth_time is required and checked', async () => {
        await service.beginAuthorization({ provider: 'google', intent: 'sign-in', authorizeParams: { max_age: 300 } });
        seedTokens();

        await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        expect(openidClient.authorizationCodeGrant).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ expectedNonce: 'nonce-token', maxAge: 300 }),
        );
      });

      it('enforces a max_age set in the provider authorizeParams', async () => {
        registry = makeRegistry({ authorizeParams: { max_age: '600' } });
        ({ service } = makeService(registry, repo, emailLookup, cache));
        await seedState();
        seedTokens();

        await service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        expect(openidClient.authorizationCodeGrant).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ maxAge: 600 }),
        );
      });

      it('propagates the code grant rejection when auth_time is missing or too old', async () => {
        await service.beginAuthorization({ provider: 'google', intent: 'sign-in', authorizeParams: { max_age: 0 } });
        vi.mocked(openidClient.authorizationCodeGrant).mockRejectedValue(new Error('JWT "auth_time" (authentication time) claim missing'));

        await expect(service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } })).rejects.toThrow('auth_time');
        expect(repo.createFactor).not.toHaveBeenCalled();
      });
    });

    describe('step-up', () => {
      const makeAudited = () => {
        const events: AuthenticationAuditEvent[] = [];
        const recorder = new AuditRecorder({ record: (event: AuthenticationAuditEvent) => void events.push(event) } as unknown as AuditSink);
        const audited = new OidcFactorService(
          new OidcFactorServiceOptions(),
          registry,
          repo,
          emailLookup,
          cache,
          encryption,
          makeLogger(),
          makePolicyService(),
          recorder,
        );
        return { audited, events };
      };

      it('returns stepped-up for a factor of the stepping-up actor and changes nothing', async () => {
        const { audited, events } = makeAudited();
        registry = makeRegistry({ persistRefreshToken: true });
        await audited.beginAuthorization({
          provider: 'google',
          intent: 'step-up',
          actorId: 'actor-1',
          redirectAfter: '/settings',
          authorizeParams: { max_age: 0 },
        });
        seedTokens({ email: 'new@example.com', amr: ['mfa'], auth_time: 1_760_000_000 }, { picture: 'https://cdn.example/new.png' });
        vi.mocked(repo.findFactor).mockResolvedValue({
          id: 'factor-1',
          actorId: 'actor-1',
          active: true,
          provider: 'google',
          subject: 'subject-1',
          email: 'old@example.com',
        });

        const result = await audited.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } });

        expect(result).toMatchObject({
          kind: 'stepped-up',
          intent: 'step-up',
          actorId: 'actor-1',
          factorId: 'factor-1',
          redirectAfter: '/settings',
          profile: { amr: ['mfa'] },
        });
        expect(openidClient.authorizationCodeGrant).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ maxAge: 0 }),
        );
        expect(repo.createFactor).not.toHaveBeenCalled();
        expect(repo.updateEmail).not.toHaveBeenCalled();
        expect(repo.updatePicture).not.toHaveBeenCalled();
        expect(repo.updateRefreshToken).not.toHaveBeenCalled();
        expect(emailLookup.findActorByEmail).not.toHaveBeenCalled();
        expect(events.map(event => event.type)).toEqual(['oidc.authorization.begun', 'oidc.stepped_up']);
      });

      it('refuses with 403 when the identity belongs to another actor', async () => {
        const { audited, events } = makeAudited();
        await audited.beginAuthorization({ provider: 'google', intent: 'step-up', actorId: 'actor-1' });
        seedTokens();
        vi.mocked(repo.findFactor).mockResolvedValue({ id: 'factor-2', actorId: 'actor-2', active: true, provider: 'google', subject: 'subject-1' });

        await expect(audited.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } })).rejects.toMatchObject({
          statusCode: 403,
          details: { provider: 'not linked to this account' },
        });
        expect(events.at(-1)).toMatchObject({
          type: 'oidc.step_up.rejected',
          outcome: 'failure',
          actorId: 'actor-1',
          data: { provider: 'google', subject: 'subject-1', reason: 'not_linked' },
        });
      });

      it('refuses with 403 when no factor exists, without auto-linking or staging a new user', async () => {
        await service.beginAuthorization({ provider: 'google', intent: 'step-up', actorId: 'actor-1' });
        seedTokens();
        vi.mocked(emailLookup.findActorByEmail).mockResolvedValue('actor-1');

        await expect(service.completeAuthorization({ params: { code: 'xyz', state: 'state-token' } })).rejects.toMatchObject({ statusCode: 403 });
        expect(repo.createFactor).not.toHaveBeenCalled();
        expect(emailLookup.findActorByEmail).not.toHaveBeenCalled();
        expect([...cache._store.keys()].some(key => key.startsWith('oidc_authorization_'))).toBe(false);
      });
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

  describe('stashAuthenticatedExchange / redeemAuthenticatedExchange', () => {
    it('round-trips actorId, factorId, and isNewUser', async () => {
      const exchangeId = await service.stashAuthenticatedExchange({ actorId: 'actor-1', factorId: 'factor-1', isNewUser: true });
      expect(exchangeId).toBeTruthy();

      const redeemed = await service.redeemAuthenticatedExchange(exchangeId);
      expect(redeemed).toEqual({ actorId: 'actor-1', factorId: 'factor-1', isNewUser: true });
    });

    it('omits isNewUser when it was not supplied', async () => {
      const exchangeId = await service.stashAuthenticatedExchange({ actorId: 'actor-1', factorId: 'factor-1' });
      const redeemed = await service.redeemAuthenticatedExchange(exchangeId);

      expect(redeemed).toEqual({ actorId: 'actor-1', factorId: 'factor-1' });
      expect(redeemed && 'isNewUser' in redeemed).toBe(false);
    });

    it('is single-use: a second redeem returns null', async () => {
      const exchangeId = await service.stashAuthenticatedExchange({ actorId: 'actor-1', factorId: 'factor-1' });

      await expect(service.redeemAuthenticatedExchange(exchangeId)).resolves.not.toBeNull();
      await expect(service.redeemAuthenticatedExchange(exchangeId)).resolves.toBeNull();
    });

    it('returns null for an unknown exchange id', async () => {
      await expect(service.redeemAuthenticatedExchange('does-not-exist')).resolves.toBeNull();
    });

    it('writes the cache entry under a stable prefix with the configured TTL', async () => {
      const exchangeId = await service.stashAuthenticatedExchange({ actorId: 'actor-1', factorId: 'factor-1' });

      const setCalls = (cache.set as ReturnType<typeof vi.fn>).mock.calls;
      const exchangeCall = setCalls.find(([key]) => (key as string).startsWith('oidc_exchange_'));
      expect(exchangeCall).toBeDefined();
      const [key, _value, ttl] = exchangeCall!;
      expect(key).toBe(`oidc_exchange_${exchangeId}`);
      expect((ttl as Duration).as('minutes')).toBeCloseTo(2, 5);
    });

    it('honors a custom TTL via OidcFactorServiceOptions', async () => {
      const customCache = makeCache();
      const customOptions = new OidcFactorServiceOptions(undefined, undefined, Duration.fromObject({ minutes: 7 }));
      const customService = new OidcFactorService(
        customOptions,
        registry,
        repo,
        emailLookup,
        customCache,
        encryption,
        makeLogger(),
        makePolicyService(),
      );

      await customService.stashAuthenticatedExchange({ actorId: 'actor-1', factorId: 'factor-1' });

      const setCalls = (customCache.set as ReturnType<typeof vi.fn>).mock.calls;
      const [, , ttl] = setCalls.find(([key]) => (key as string).startsWith('oidc_exchange_'))!;
      expect((ttl as Duration).as('minutes')).toBeCloseTo(7, 5);
    });
  });
});
