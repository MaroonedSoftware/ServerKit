import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticationSessionService } from '../src/authentication.session.service.js';
import type { CacheProvider } from '@maroonedsoftware/cache';
import type { JwtProvider } from '../src/providers/jwt.provider.js';
import type { AuthenticationSessionFactor } from '../src/authentication.context.js';
import { Duration } from 'luxon';

const makeCacheProvider = () =>
  ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(null),
  }) as unknown as CacheProvider;

const makeJwtProvider = () =>
  ({
    create: vi.fn(),
    decode: vi.fn(),
  }) as unknown as JwtProvider;

const makeFactor = (overrides: Partial<AuthenticationSessionFactor> = {}): AuthenticationSessionFactor => ({
  issuedAt: 1700000000,
  authenticatedAt: 1700000000,
  method: 'password',
  methodId: 'pw-1',
  kind: 'knowledge',
  ...overrides,
});

const makeOptions = () => ({
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
  expiresIn: Duration.fromObject({ hours: 1 }),
});

const makeSession = (overrides = {}) => ({
  token: 'session-token',
  subject: 'user-1',
  issuedAt: 1700000000,
  expiresAt: 1700003600,
  lastAccessedAt: 1700000000,
  factors: [makeFactor()],
  claims: { role: 'admin' },
  ...overrides,
});

describe('AuthenticationSessionService', () => {
  let cache: ReturnType<typeof makeCacheProvider>;
  let jwtProvider: ReturnType<typeof makeJwtProvider>;
  let service: AuthenticationSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCacheProvider();
    jwtProvider = makeJwtProvider();
    service = new AuthenticationSessionService(makeOptions(), cache, jwtProvider);
  });

  describe('createSession', () => {
    it('returns a session with correct subject and claims', async () => {
      vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('test-uuid' as ReturnType<typeof crypto.randomUUID>);
      cache.get = vi.fn().mockResolvedValue(null);

      const factor = makeFactor();
      const session = await service.createSession('user-1', { role: 'admin' }, factor);

      expect(session.token).toBe('test-uuid');
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
      const session = makeSession({ subject: 'user-1' });
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session));
      await expect(service.updateSession('session-token', 'user-2')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('merges new claims into the existing session claims', async () => {
      const session = makeSession({ claims: { role: 'user' } });
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(null);
      const updated = await service.updateSession('session-token', 'user-1', undefined, { plan: 'pro' });
      expect(updated.claims).toMatchObject({ role: 'user', plan: 'pro' });
    });

    it('adds a new factor when methodId is not already in the session', async () => {
      const session = makeSession({ factors: [makeFactor({ methodId: 'pw-1' })] });
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(null);
      const newFactor = makeFactor({ methodId: 'totp-1', method: 'authenticator', kind: 'possession' });
      const updated = await service.updateSession('session-token', 'user-1', undefined, undefined, newFactor);
      expect(updated.factors).toHaveLength(2);
    });

    it('updates authenticatedAt for an existing factor by methodId', async () => {
      const session = makeSession({ factors: [makeFactor({ methodId: 'pw-1', authenticatedAt: 1700000000 })] });
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(null);
      const updatedFactor = makeFactor({ methodId: 'pw-1', authenticatedAt: 1700001000 });
      const updated = await service.updateSession('session-token', 'user-1', undefined, undefined, updatedFactor);
      expect(updated.factors).toHaveLength(1);
      expect(updated.factors[0]!.authenticatedAt).toBe(1700001000);
    });

    it('calls cache.update with the serialised session', async () => {
      const session = makeSession();
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
      const session = makeSession();
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
      const session = makeSession({ subject: 'user-1' });
      jwtProvider.decode = vi.fn().mockReturnValue({ sessionToken: 'session-token', subject: 'user-2' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      await expect(service.lookupSessionFromJwt('valid.jwt')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns the session and decoded JWT payload on success', async () => {
      const session = makeSession({ subject: 'user-1' });
      const payload = { sessionToken: 'session-token', subject: 'user-1' };
      jwtProvider.decode = vi.fn().mockReturnValue(payload);
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      const result = await service.lookupSessionFromJwt('valid.jwt');
      expect(result.session.token).toBe('session-token');
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
      const session = makeSession();
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(session)).mockResolvedValueOnce(JSON.stringify(['session-token']));
      await service.deleteSession('session-token');
      expect(cache.delete).toHaveBeenCalledWith('auth_session_session-token');
    });

    it('removes the token from the subject session list', async () => {
      const session = makeSession();
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

    it('parses and returns the session from cache', async () => {
      const session = makeSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      const result = await service.getSession('session-token');
      expect(result).toEqual(session);
    });
  });

  describe('getSessionsForSubject', () => {
    it('returns an empty array when the subject has no sessions', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      const result = await service.getSessionsForSubject('user-1');
      expect(result).toEqual([]);
    });

    it('returns all sessions for the subject', async () => {
      const session = makeSession();
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(['session-token'])).mockResolvedValueOnce(JSON.stringify(session));
      const result = await service.getSessionsForSubject('user-1');
      expect(result).toHaveLength(1);
      expect(result[0]!.token).toBe('session-token');
    });

    it('omits sessions that no longer exist in cache', async () => {
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(['stale-token'])).mockResolvedValueOnce(null);
      const result = await service.getSessionsForSubject('user-1');
      expect(result).toEqual([]);
    });
  });

  describe('generateAuthToken', () => {
    it('throws 401 when the session does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.generateAuthToken('missing-token')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('calls jwtProvider.create with the session data', async () => {
      const session = makeSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      jwtProvider.create = vi.fn().mockReturnValue({ token: 'jwt', decoded: { exp: 3600 } });

      await service.generateAuthToken('session-token');

      expect(jwtProvider.create).toHaveBeenCalledWith(
        expect.objectContaining({ sessionToken: 'session-token', factors: session.factors, role: 'admin' }),
        'user-1',
        'https://auth.example.com',
        'https://api.example.com',
        expect.any(Duration),
      );
    });

    it('returns a Bearer token response', async () => {
      const session = makeSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      jwtProvider.create = vi.fn().mockReturnValue({ token: 'my-jwt', decoded: { exp: 3600 } });

      const result = await service.generateAuthToken('session-token');

      expect(result.accessToken).toBe('my-jwt');
      expect(result.tokenType).toBe('Bearer');
    });

    it('includes scope from the decoded JWT when present', async () => {
      const session = makeSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      jwtProvider.create = vi.fn().mockReturnValue({ token: 'my-jwt', decoded: { exp: 3600, scope: ['read', 'write'] } });

      const result = await service.generateAuthToken('session-token');

      expect(result.scope).toBe('read write');
    });

    it('returns empty scope when decoded JWT has no scope', async () => {
      const session = makeSession();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(session));
      jwtProvider.create = vi.fn().mockReturnValue({ token: 'my-jwt', decoded: { exp: 3600 } });

      const result = await service.generateAuthToken('session-token');

      expect(result.scope).toBe('');
    });
  });
});
