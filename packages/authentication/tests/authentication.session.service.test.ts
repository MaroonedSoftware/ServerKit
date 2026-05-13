import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticationSessionService } from '../src/authentication.session.service.js';
import type { CacheProvider } from '@maroonedsoftware/cache';
import type { Logger } from '@maroonedsoftware/logger';
import type { JwtProvider } from '../src/providers/jwt.provider.js';
import type { AuthenticationSessionFactor, AuthenticationSessionHooks } from '../src/types.js';
import { DateTime, Duration } from 'luxon';

const makeCacheProvider = () =>
  ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(null),
  }) as unknown as CacheProvider;

const makeJwtProvider = () =>
  ({
    create: vi.fn().mockReturnValue({ token: 'access-jwt', decoded: { exp: 1700003600 } }),
    decode: vi.fn(),
  }) as unknown as JwtProvider;

const makeLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }) as unknown as Logger;

/**
 * Live factor passed to service methods. Times are real `DateTime` instances —
 * the service serializes them at the cache boundary via `.toUnixInteger()`.
 */
const makeFactor = (overrides: Partial<AuthenticationSessionFactor> = {}): AuthenticationSessionFactor => ({
  issuedAt: DateTime.fromSeconds(1700000000),
  authenticatedAt: DateTime.fromSeconds(1700000000),
  method: 'password',
  methodId: 'pw-1',
  kind: 'knowledge',
  ...overrides,
});

const makeOptions = (hooks: AuthenticationSessionHooks = {}) => ({
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
  expiresIn: Duration.fromObject({ hours: 1 }),
  refreshExpiresIn: Duration.fromObject({ days: 30 }),
  hooks,
});

/**
 * Stored shape — the JSON that `serializeSession` writes and `deserializeSession`
 * reads. Times are Unix integers.
 */
const makeStoredSession = (overrides: Record<string, unknown> = {}) => ({
  sessionToken: 'session-token',
  subject: 'user-1',
  issuedAt: 1700000000,
  expiresAt: 1700003600,
  lastAccessedAt: 1700000000,
  factors: [{ method: 'password', methodId: 'pw-1', kind: 'knowledge', issuedAt: 1700000000, authenticatedAt: 1700000000 }],
  claims: { role: 'admin' },
  familyId: 'family-1',
  ...overrides,
});

describe('AuthenticationSessionService', () => {
  let cache: ReturnType<typeof makeCacheProvider>;
  let jwtProvider: ReturnType<typeof makeJwtProvider>;
  let logger: ReturnType<typeof makeLogger>;
  let service: AuthenticationSessionService;

  beforeEach(() => {
    vi.restoreAllMocks();
    cache = makeCacheProvider();
    jwtProvider = makeJwtProvider();
    logger = makeLogger();
    service = new AuthenticationSessionService(makeOptions(), cache, jwtProvider, logger);
  });

  describe('createSession', () => {
    it('returns a session with correct subject and claims', async () => {
      vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('test-uuid' as ReturnType<typeof crypto.randomUUID>);
      cache.get = vi.fn().mockResolvedValue(null);

      const factor = makeFactor();
      const session = await service.createSession('user-1', { role: 'admin' }, factor);

      expect(session.sessionToken).toBe('test-uuid');
      expect(session.subject).toBe('user-1');
      expect(session.claims).toEqual({ role: 'admin' });
    });

    it('wraps a single factor in an array', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      const factor = makeFactor();
      const session = await service.createSession('user-1', {}, factor);
      expect(session.factors).toEqual([factor]);
    });

    it('accepts an array of factors', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      const factors = [makeFactor({ methodId: 'pw-1' }), makeFactor({ methodId: 'totp-1', method: 'authenticator', kind: 'possession' })];
      const session = await service.createSession('user-1', {}, factors);
      expect(session.factors).toHaveLength(2);
    });

    it('stores the session in cache', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('test-uuid' as ReturnType<typeof crypto.randomUUID>);
      await service.createSession('user-1', {}, makeFactor());
      expect(cache.set).toHaveBeenCalledWith('auth_session_test-uuid', expect.any(String), expect.any(Duration));
    });

    it('registers the token under the subject key', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('test-uuid' as ReturnType<typeof crypto.randomUUID>);
      await service.createSession('user-1', {}, makeFactor());
      expect(cache.set).toHaveBeenCalledWith('auth_session_subject_user-1', JSON.stringify(['test-uuid']), expect.any(Duration));
    });
  });

  describe('updateSession', () => {
    it('throws 401 when the session does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.updateSession('missing-token', 'user-1')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when the subject does not match the session', async () => {
      const session = makeStoredSession({ subject: 'user-1' });
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session));
      await expect(service.updateSession('session-token', 'user-2')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('merges new claims into the existing session claims', async () => {
      const session = makeStoredSession({ claims: { role: 'user' } });
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(null);
      const updated = await service.updateSession('session-token', 'user-1', undefined, { plan: 'pro' });
      expect(updated.claims).toMatchObject({ role: 'user', plan: 'pro' });
    });

    it('adds a new factor when methodId is not already in the session', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(null);
      const newFactor = makeFactor({ methodId: 'totp-1', method: 'authenticator', kind: 'possession' });
      const updated = await service.updateSession('session-token', 'user-1', undefined, undefined, newFactor);
      expect(updated.factors).toHaveLength(2);
    });

    it('updates authenticatedAt for an existing factor by methodId', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(null);
      const updatedFactor = makeFactor({ methodId: 'pw-1', authenticatedAt: DateTime.fromSeconds(1700001000) });
      const updated = await service.updateSession('session-token', 'user-1', undefined, undefined, updatedFactor);
      expect(updated.factors).toHaveLength(1);
      expect(updated.factors[0]!.authenticatedAt.toUnixInteger()).toBe(1700001000);
    });

    it('calls cache.update with the serialised session', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(null);
      await service.updateSession('session-token', 'user-1');
      expect(cache.update).toHaveBeenCalledWith('auth_session_session-token', expect.any(String), expect.any(Duration));
    });
  });

  describe('createOrUpdateSession', () => {
    it('creates a new session when no token is provided', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      vi.spyOn(service, 'createSession' as keyof typeof service);
      await service.createOrUpdateSession(undefined, 'user-1', {}, makeFactor());
      expect(cache.set).toHaveBeenCalled();
    });

    it('creates a new session when the token does not resolve to a session', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await service.createOrUpdateSession('stale-token', 'user-1', {}, makeFactor());
      expect(cache.set).toHaveBeenCalled();
    });

    it('updates the existing session when the token resolves to a session', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(null);
      await service.createOrUpdateSession('session-token', 'user-1', {}, makeFactor());
      expect(cache.update).toHaveBeenCalled();
    });
  });

  describe('lookupSessionFromJwt', () => {
    it('throws 401 when the JWT cannot be decoded', async () => {
      jwtProvider.decode = vi.fn().mockReturnValue(undefined);
      await expect(service.lookupSessionFromJwt('bad.jwt')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when no session exists for the JWT sessionToken', async () => {
      jwtProvider.decode = vi.fn().mockReturnValue({ sessionToken: 'missing-token', subject: 'user-1' });
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.lookupSessionFromJwt('valid.jwt')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when the session subject does not match the JWT subject', async () => {
      const session = makeStoredSession({ subject: 'user-1' });
      jwtProvider.decode = vi.fn().mockReturnValue({ sessionToken: 'session-token', subject: 'user-2' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      await expect(service.lookupSessionFromJwt('valid.jwt')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns the session and decoded JWT payload on success', async () => {
      const session = makeStoredSession({ subject: 'user-1' });
      const payload = { sessionToken: 'session-token', subject: 'user-1' };
      jwtProvider.decode = vi.fn().mockReturnValue(payload);
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      const result = await service.lookupSessionFromJwt('valid.jwt');
      expect(result.session.sessionToken).toBe('session-token');
      expect(result.jwtPayload).toBe(payload);
    });
  });

  describe('deleteSession', () => {
    it('does nothing when the session does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await service.deleteSession('missing-token');
      expect(cache.delete).not.toHaveBeenCalled();
    });

    it('deletes the session key from cache', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(JSON.stringify(['session-token']));
      await service.deleteSession('session-token');
      expect(cache.delete).toHaveBeenCalledWith('auth_session_session-token');
    });

    it('removes the token from the subject session list', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(JSON.stringify(['session-token']));
      await service.deleteSession('session-token');
      expect(cache.update).toHaveBeenCalledWith('auth_session_subject_user-1', JSON.stringify([]));
    });
  });

  describe('getSession', () => {
    it('returns undefined when the session is not in cache', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      const result = await service.getSession('missing-token');
      expect(result).toBeUndefined();
    });

    it('parses the session from cache and revives DateTime fields', async () => {
      const stored = makeStoredSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(stored));
      const result = await service.getSession('session-token');

      expect(result).toBeDefined();
      expect(result!.sessionToken).toBe(stored.sessionToken);
      expect(result!.subject).toBe(stored.subject);
      expect(result!.claims).toEqual(stored.claims);
      expect(result!.issuedAt.toUnixInteger()).toBe(stored.issuedAt);
      expect(result!.expiresAt.toUnixInteger()).toBe(stored.expiresAt);
      expect(result!.lastAccessedAt.toUnixInteger()).toBe(stored.lastAccessedAt);
      expect(result!.factors).toHaveLength(1);
      expect(result!.factors[0]!.method).toBe('password');
      expect(result!.factors[0]!.methodId).toBe('pw-1');
      expect(result!.factors[0]!.kind).toBe('knowledge');
      expect(result!.factors[0]!.issuedAt.toUnixInteger()).toBe(1700000000);
      expect(result!.factors[0]!.authenticatedAt.toUnixInteger()).toBe(1700000000);
    });
  });

  describe('getSessionsForSubject', () => {
    it('returns an empty array when the subject has no sessions', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      const result = await service.getSessionsForSubject('user-1');
      expect(result).toEqual([]);
    });

    it('returns all sessions for the subject', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(['session-token'])).mockResolvedValueOnce(JSON.stringify(session));
      const result = await service.getSessionsForSubject('user-1');
      expect(result).toHaveLength(1);
      expect(result[0]!.sessionToken).toBe('session-token');
    });

    it('omits sessions that no longer exist in cache', async () => {
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(['stale-token'])).mockResolvedValueOnce(null);
      const result = await service.getSessionsForSubject('user-1');
      expect(result).toEqual([]);
    });
  });

  describe('issueTokenForSession', () => {
    it('throws 401 when the session does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.issueTokenForSession('missing-token')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('calls jwtProvider.create with the session data', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      jwtProvider.create = vi.fn().mockReturnValue({ token: 'jwt', decoded: { exp: 3600 } });

      await service.issueTokenForSession('session-token');

      expect(jwtProvider.create).toHaveBeenCalledWith(
        expect.objectContaining({ sessionToken: 'session-token', claims: { role: 'admin' } }),
        'user-1',
        'https://auth.example.com',
        'https://api.example.com',
        expect.any(Duration),
      );
      const passedFactors = (jwtProvider.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].factors;
      expect(passedFactors).toHaveLength(1);
      expect(passedFactors[0].methodId).toBe('pw-1');
      expect(passedFactors[0].authenticatedAt.toUnixInteger()).toBe(1700000000);
    });

    it('returns a Bearer token response with expiresIn taken from the JWT exp claim', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      jwtProvider.create = vi.fn().mockReturnValue({ token: 'my-jwt', decoded: { exp: 1700003600 } });

      const result = await service.issueTokenForSession('session-token');

      expect(result.accessToken).toBe('my-jwt');
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(1700003600);
    });

    it('returns expiresIn=0 when the decoded JWT is missing an exp claim', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      jwtProvider.create = vi.fn().mockReturnValue({ token: 'my-jwt', decoded: {} });

      const result = await service.issueTokenForSession('session-token');

      expect(result.expiresIn).toBe(0);
    });

    it('includes scope from the decoded JWT when present', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      jwtProvider.create = vi.fn().mockReturnValue({ token: 'my-jwt', decoded: { exp: 3600, scope: ['read', 'write'] } });

      const result = await service.issueTokenForSession('session-token');

      expect(result.scope).toBe('read write');
    });

    it('returns empty scope when decoded JWT has no scope', async () => {
      const session = makeStoredSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      jwtProvider.create = vi.fn().mockReturnValue({ token: 'my-jwt', decoded: { exp: 3600 } });

      const result = await service.issueTokenForSession('session-token');

      expect(result.scope).toBe('');
    });
  });

  describe('serialize / deserialize round-trip', () => {
    it('preserves all session and factor fields across the cache boundary', async () => {
      // Capture whatever the service writes to the cache and replay it on read.
      const store = new Map<string, string>();
      cache.get = vi.fn().mockImplementation(async (k: string) => store.get(k) ?? null);
      cache.set = vi.fn().mockImplementation(async (k: string, v: string) => {
        store.set(k, v);
      });

      const factor = makeFactor({
        method: 'fido',
        methodId: 'fido-key-1',
        kind: 'possession',
        issuedAt: DateTime.fromSeconds(1700000000),
        authenticatedAt: DateTime.fromSeconds(1700000500),
      });

      const created = await service.createSession('user-1', { plan: 'pro', roles: ['admin'] }, factor);
      const reloaded = await service.getSession(created.sessionToken);

      expect(reloaded).toBeDefined();
      expect(reloaded!.sessionToken).toBe(created.sessionToken);
      expect(reloaded!.subject).toBe('user-1');
      expect(reloaded!.claims).toEqual({ plan: 'pro', roles: ['admin'] });
      expect(reloaded!.issuedAt.toUnixInteger()).toBe(created.issuedAt.toUnixInteger());
      expect(reloaded!.expiresAt.toUnixInteger()).toBe(created.expiresAt.toUnixInteger());
      expect(reloaded!.lastAccessedAt.toUnixInteger()).toBe(created.lastAccessedAt.toUnixInteger());
      expect(reloaded!.factors).toHaveLength(1);
      expect(reloaded!.factors[0]!.method).toBe('fido');
      expect(reloaded!.factors[0]!.methodId).toBe('fido-key-1');
      expect(reloaded!.factors[0]!.kind).toBe('possession');
      expect(reloaded!.factors[0]!.issuedAt.toUnixInteger()).toBe(1700000000);
      expect(reloaded!.factors[0]!.authenticatedAt.toUnixInteger()).toBe(1700000500);
    });

    it('mints a familyId on createSession and round-trips it via getSession', async () => {
      const store = new Map<string, string>();
      cache.get = vi.fn().mockImplementation(async (k: string) => store.get(k) ?? null);
      cache.set = vi.fn().mockImplementation(async (k: string, v: string) => {
        store.set(k, v);
      });
      const created = await service.createSession('user-1', {}, makeFactor());
      expect(created.familyId).toBeDefined();
      expect(created.familyId).not.toBe('');
      const reloaded = await service.getSession(created.sessionToken);
      expect(reloaded?.familyId).toBe(created.familyId);
    });

    it('produces session DateTimes that survive a refresh via updateSession', async () => {
      // updateSession reads from cache, calls .plus() on the deserialized expiresAt,
      // and writes back — exercising the full DateTime ↔ Unix-int round-trip.
      const store = new Map<string, string>();
      cache.get = vi.fn().mockImplementation(async (k: string) => store.get(k) ?? null);
      cache.set = vi.fn().mockImplementation(async (k: string, v: string) => {
        store.set(k, v);
      });
      cache.update = vi.fn().mockImplementation(async (k: string, v: string) => {
        store.set(k, v);
      });

      const created = await service.createSession('user-1', {}, makeFactor());
      const updated = await service.updateSession(created.sessionToken, 'user-1', Duration.fromObject({ minutes: 30 }));

      expect(updated.expiresAt.toUnixInteger()).toBe(created.expiresAt.toUnixInteger() + 30 * 60);
      expect(updated.lastAccessedAt.toUnixInteger()).toBeGreaterThanOrEqual(created.lastAccessedAt.toUnixInteger());
    });
  });

  /**
   * Shared in-memory cache + JWT stub used by the refresh / rotation / hook
   * suites. `cache.get/set/update/delete` operate on a Map so the service can
   * read what it wrote without each test painstakingly chaining
   * `mockResolvedValueOnce` calls. `jwtProvider.create` returns deterministic
   * tokens and `jwtProvider.decode` is stubbed per-test.
   */
  function makeLiveHarness() {
    const store = new Map<string, string>();
    const cacheImpl = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      update: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      delete: vi.fn(async (k: string) => {
        store.delete(k);
        return null;
      }),
    } as unknown as CacheProvider;

    let nextToken = 0;
    const jwtImpl = {
      create: vi.fn((payload: Record<string, unknown>) => {
        const token = `jwt-${++nextToken}`;
        const exp = Math.floor(Date.now() / 1000) + 3600;
        return { token, decoded: { exp, _payload: payload } };
      }),
      decode: vi.fn(),
    } as unknown as JwtProvider;

    return { store, cache: cacheImpl, jwtProvider: jwtImpl, logger: makeLogger() };
  }

  describe('issueTokenForSession — refresh token + family seeding', () => {
    it('issues an access token AND a refresh token bound to the session family', async () => {
      const harness = makeLiveHarness();
      const svc = new AuthenticationSessionService(makeOptions(), harness.cache, harness.jwtProvider, harness.logger);

      const session = await svc.createSession('user-1', {}, makeFactor());
      const tokens = await svc.issueTokenForSession(session.sessionToken);

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.tokenType).toBe('Bearer');

      // jwtProvider.create called twice — once for access, once for refresh.
      // The refresh-token payload (2nd call) carries the family + jti claims.
      const refreshPayload = (harness.jwtProvider.create as ReturnType<typeof vi.fn>).mock.calls[1]![0] as Record<string, unknown>;
      expect(refreshPayload.kind).toBe('refresh');
      expect(refreshPayload.familyId).toBe(session.familyId);
      expect(refreshPayload.sessionToken).toBe(session.sessionToken);
      expect(typeof refreshPayload.jti).toBe('string');
    });

    it('registers the issued jti in the family blob so it can be rotated/revoked later', async () => {
      const harness = makeLiveHarness();
      const svc = new AuthenticationSessionService(makeOptions(), harness.cache, harness.jwtProvider, harness.logger);

      const session = await svc.createSession('user-1', {}, makeFactor());
      await svc.issueTokenForSession(session.sessionToken);

      const familyRaw = harness.store.get(`auth_refresh_family_${session.familyId}`);
      expect(familyRaw).toBeDefined();
      const family = JSON.parse(familyRaw!);
      expect(family.jtis).toHaveLength(1);
      expect(family.sessionTokens).toContain(session.sessionToken);
    });
  });

  describe('refreshSession — rotation', () => {
    it('rotates jti, marks the previous jti consumed, and returns a fresh token pair', async () => {
      const harness = makeLiveHarness();
      const svc = new AuthenticationSessionService(makeOptions(), harness.cache, harness.jwtProvider, harness.logger);
      const onSessionRefreshed = vi.fn();
      const svcWithHook = new AuthenticationSessionService(
        makeOptions({ onSessionRefreshed }),
        harness.cache,
        harness.jwtProvider,
        harness.logger,
      );

      const session = await svc.createSession('user-1', {}, makeFactor());
      const first = await svcWithHook.issueTokenForSession(session.sessionToken);

      // The refresh-token payload from issueTokenForSession is what the
      // service would later get back via jwtProvider.decode on the wire.
      const firstRefreshPayload = (harness.jwtProvider.create as ReturnType<typeof vi.fn>).mock.calls[1]![0] as {
        kind: string;
        jti: string;
        familyId: string;
        sessionToken: string;
      };
      (harness.jwtProvider.decode as ReturnType<typeof vi.fn>).mockReturnValue({
        ...firstRefreshPayload,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const second = await svcWithHook.refreshSession(first.refreshToken!);

      expect(second.accessToken).toBeDefined();
      expect(second.refreshToken).toBeDefined();
      expect(second.accessToken).not.toBe(first.accessToken);
      expect(second.refreshToken).not.toBe(first.refreshToken);

      // The previous jti is now marked consumed.
      expect(harness.store.get(`auth_refresh_consumed_${firstRefreshPayload.jti}`)).toBeDefined();

      // Hook fires with the previous jti.
      expect(onSessionRefreshed).toHaveBeenCalledTimes(1);
      expect(onSessionRefreshed.mock.calls[0]![1]).toMatchObject({ previousJti: firstRefreshPayload.jti });
    });

    it('rejects a replayed (consumed) refresh token AND revokes every session in the family', async () => {
      const harness = makeLiveHarness();
      const onRefreshReuseDetected = vi.fn();
      const onSessionRevoked = vi.fn();
      const svc = new AuthenticationSessionService(
        makeOptions({ onRefreshReuseDetected, onSessionRevoked }),
        harness.cache,
        harness.jwtProvider,
        harness.logger,
      );

      const session = await svc.createSession('user-1', {}, makeFactor());
      const tokens = await svc.issueTokenForSession(session.sessionToken);
      const refreshPayload = (harness.jwtProvider.create as ReturnType<typeof vi.fn>).mock.calls[1]![0] as {
        kind: string;
        jti: string;
        familyId: string;
        sessionToken: string;
      };

      // First refresh succeeds — marks the original jti consumed.
      (harness.jwtProvider.decode as ReturnType<typeof vi.fn>).mockReturnValue({
        ...refreshPayload,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      await svc.refreshSession(tokens.refreshToken!);

      // Replay the now-consumed original refresh token.
      await expect(svc.refreshSession(tokens.refreshToken!)).rejects.toMatchObject({ statusCode: 401 });

      // Family is gone; session is gone.
      expect(harness.store.get(`auth_refresh_family_${session.familyId}`)).toBeUndefined();
      expect(harness.store.get(`auth_session_${session.sessionToken}`)).toBeUndefined();

      // Hooks fired with the expected metadata.
      expect(onRefreshReuseDetected).toHaveBeenCalledTimes(1);
      expect(onRefreshReuseDetected.mock.calls[0]![0]).toMatchObject({
        familyId: session.familyId,
        jti: refreshPayload.jti,
        sessionToken: session.sessionToken,
      });
      expect(onSessionRevoked).toHaveBeenCalled();
      expect(onSessionRevoked.mock.calls.some(c => c[1]?.reason === 'theft')).toBe(true);
    });

    it('rejects a refresh token with a missing/wrong kind claim', async () => {
      const harness = makeLiveHarness();
      const svc = new AuthenticationSessionService(makeOptions(), harness.cache, harness.jwtProvider, harness.logger);
      (harness.jwtProvider.decode as ReturnType<typeof vi.fn>).mockReturnValue({
        // No `kind: 'refresh'` discriminator.
        jti: 'jti-1',
        familyId: 'family-1',
        sessionToken: 'session-token',
      });
      await expect(svc.refreshSession('bogus.jwt')).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe('rotateSession — privilege change', () => {
    it('mints a new sessionToken, preserves familyId, deletes the old session, fires hooks', async () => {
      const harness = makeLiveHarness();
      const onSessionCreated = vi.fn();
      const onSessionRevoked = vi.fn();
      const svc = new AuthenticationSessionService(
        makeOptions({ onSessionCreated, onSessionRevoked }),
        harness.cache,
        harness.jwtProvider,
        harness.logger,
      );

      const old = await svc.createSession('user-1', { acr: 'low' }, makeFactor());
      const rotated = await svc.rotateSession(old.sessionToken, { acr: 'high', mfa_satisfied: true });

      expect(rotated.session.sessionToken).not.toBe(old.sessionToken);
      expect(rotated.session.familyId).toBe(old.familyId);
      expect(rotated.session.claims).toMatchObject({ acr: 'high', mfa_satisfied: true });
      expect(rotated.accessToken).toBeDefined();
      expect(rotated.refreshToken).toBeDefined();

      // Old session blob deleted; new session blob present.
      expect(harness.store.get(`auth_session_${old.sessionToken}`)).toBeUndefined();
      expect(harness.store.get(`auth_session_${rotated.session.sessionToken}`)).toBeDefined();

      // Hooks fired with the right reasons. createSession itself fires
      // onSessionCreated once for `old`, then rotate fires it once for the new
      // session and onSessionRevoked once for the old with reason='rotate'.
      expect(onSessionCreated).toHaveBeenCalledTimes(2);
      const lastCreated = onSessionCreated.mock.calls.at(-1)![0];
      expect(lastCreated.sessionToken).toBe(rotated.session.sessionToken);

      expect(onSessionRevoked).toHaveBeenCalledTimes(1);
      expect(onSessionRevoked.mock.calls[0]![1]).toEqual({ reason: 'rotate' });
      expect(onSessionRevoked.mock.calls[0]![0].sessionToken).toBe(old.sessionToken);
    });

    it('throws 401 when the source session does not exist', async () => {
      const harness = makeLiveHarness();
      const svc = new AuthenticationSessionService(makeOptions(), harness.cache, harness.jwtProvider, harness.logger);
      await expect(svc.rotateSession('missing-token')).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe('lifecycle hooks — robustness', () => {
    it('logs but does not propagate errors thrown by hooks', async () => {
      const harness = makeLiveHarness();
      const onSessionCreated = vi.fn().mockImplementation(() => {
        throw new Error('hook exploded');
      });
      const svc = new AuthenticationSessionService(
        makeOptions({ onSessionCreated }),
        harness.cache,
        harness.jwtProvider,
        harness.logger,
      );

      // Must not throw despite the failing hook.
      const session = await svc.createSession('user-1', {}, makeFactor());
      expect(session.sessionToken).toBeDefined();
      expect(harness.logger.error).toHaveBeenCalled();
    });

    it('fires onValidationFailed when lookupSessionFromJwt cannot resolve the session', async () => {
      const harness = makeLiveHarness();
      const onValidationFailed = vi.fn();
      const svc = new AuthenticationSessionService(
        makeOptions({ onValidationFailed }),
        harness.cache,
        harness.jwtProvider,
        harness.logger,
      );
      (harness.jwtProvider.decode as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionToken: 'ghost-token',
        subject: 'user-1',
      });
      await expect(svc.lookupSessionFromJwt('bad.jwt')).rejects.toMatchObject({ statusCode: 401 });
      expect(onValidationFailed).toHaveBeenCalledWith('ghost-token', { reason: 'session_not_found' });
    });
  });
});
