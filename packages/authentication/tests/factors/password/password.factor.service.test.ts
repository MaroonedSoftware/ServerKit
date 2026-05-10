import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RateLimiterCompatibleAbstract } from 'rate-limiter-flexible';
import { PasswordFactorService } from '../../../src/factors/password/password.factor.service.js';
import type {
  PasswordFactor,
  PasswordFactorRepository,
  PasswordValue,
} from '../../../src/factors/password/password.factor.repository.js';
import type { PasswordStrengthProvider } from '../../../src/providers/password.strength.provider.js';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { httpError } from '@maroonedsoftware/errors';
import { DateTime } from 'luxon';

const hashPassword = (password: string, salt?: Buffer): PasswordValue => {
  salt ??= crypto.randomBytes(32);
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512');
  return { hash: hash.toString('base64'), salt: salt.toString('base64') };
};

const makeRepository = () =>
  ({
    createFactor: vi.fn(),
    listPreviousPasswords: vi.fn().mockResolvedValue([]),
    updateFactor: vi.fn(),
    getFactor: vi.fn(),
    deleteFactor: vi.fn(),
  }) as unknown as PasswordFactorRepository;

const makeRateLimiter = () =>
  ({
    consume: vi.fn().mockResolvedValue(undefined),
    reward: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }) as unknown as RateLimiterCompatibleAbstract;

const makeStrengthProvider = () =>
  ({
    checkStrength: vi.fn().mockResolvedValue({ valid: true, score: 4, feedback: { warning: '', suggestions: [] } }),
    ensureStrength: vi.fn().mockResolvedValue(undefined),
  }) as unknown as PasswordStrengthProvider;

const makeCacheProvider = () =>
  ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(null),
  }) as unknown as CacheProvider;

const makeRegistrationPayload = (overrides: Record<string, unknown> = {}) => ({
  id: 'reg-id-1',
  hash: 'cached-hash',
  salt: 'cached-salt',
  expiresAt: DateTime.utc().plus({ minutes: 10 }).toUnixInteger(),
  issuedAt: DateTime.utc().toUnixInteger(),
  ...overrides,
});

const makePasswordFactor = (overrides: Partial<PasswordFactor> = {}): PasswordFactor => ({
  id: 'factor-1',
  actorId: 'actor-1',
  active: true,
  needsReset: false,
  value: hashPassword('correct-horse-battery-staple'),
  ...overrides,
});

describe('PasswordFactorService', () => {
  let repo: ReturnType<typeof makeRepository>;
  let rateLimiter: ReturnType<typeof makeRateLimiter>;
  let strengthProvider: ReturnType<typeof makeStrengthProvider>;
  let cache: ReturnType<typeof makeCacheProvider>;
  let service: PasswordFactorService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepository();
    rateLimiter = makeRateLimiter();
    strengthProvider = makeStrengthProvider();
    cache = makeCacheProvider();
    service = new PasswordFactorService(repo, rateLimiter, strengthProvider, cache);
  });

  describe('createPasswordFactor', () => {
    it('throws when ensureStrength rejects', async () => {
      strengthProvider.ensureStrength = vi.fn().mockRejectedValue(httpError(400).withDetails({ password: 'too weak' }));

      await expect(service.createPasswordFactor('actor-1', 'weak')).rejects.toMatchObject({ statusCode: 400 });
      expect(repo.createFactor).not.toHaveBeenCalled();
    });

    it('checks strength before looking up the existing factor', async () => {
      strengthProvider.ensureStrength = vi.fn().mockRejectedValue(httpError(400));

      await expect(service.createPasswordFactor('actor-1', 'weak')).rejects.toMatchObject({ statusCode: 400 });
      expect(repo.getFactor).not.toHaveBeenCalled();
    });

    it('throws 409 when a password factor already exists for the actor', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor());

      await expect(service.createPasswordFactor('actor-1', 'strong-pass')).rejects.toMatchObject({
        statusCode: 409,
        details: { actorId: 'Password factor already exists' },
      });
      expect(repo.createFactor).not.toHaveBeenCalled();
    });

    it('creates a new factor and returns it', async () => {
      const factor = makePasswordFactor({ id: 'new-factor' });
      repo.getFactor = vi.fn().mockResolvedValue(undefined);
      repo.createFactor = vi.fn().mockResolvedValue(factor);

      const result = await service.createPasswordFactor('actor-1', 'strong-pass', true);

      expect(result).toBe(factor);
      expect(strengthProvider.ensureStrength).toHaveBeenCalledWith('strong-pass');
      expect(repo.createFactor).toHaveBeenCalledTimes(1);
      const [actorId, value] = vi.mocked(repo.createFactor).mock.calls[0]!;
      expect(actorId).toBe('actor-1');
      expect(value.hash).toBeTruthy();
      expect(value.salt).toBeTruthy();
      expect(value.needsReset).toBe(true);
    });

    it('defaults needsReset to false', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(undefined);
      repo.createFactor = vi.fn().mockResolvedValue(makePasswordFactor());

      await service.createPasswordFactor('actor-1', 'strong-pass');

      expect(vi.mocked(repo.createFactor).mock.calls[0]![1].needsReset).toBe(false);
    });
  });

  describe('registerPasswordFactor', () => {
    it('throws when ensureStrength rejects', async () => {
      strengthProvider.ensureStrength = vi.fn().mockRejectedValue(httpError(400).withDetails({ password: 'too weak' }));

      await expect(service.registerPasswordFactor('weak')).rejects.toMatchObject({ statusCode: 400 });
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('caches a fresh registration and returns registrationId, expiresAt, issuedAt, alreadyRegistered=false', async () => {
      const result = await service.registerPasswordFactor('strong-pass');

      expect(result.registrationId).toBeTruthy();
      expect(result.alreadyRegistered).toBe(false);
      expect(DateTime.isDateTime(result.expiresAt)).toBe(true);
      expect(DateTime.isDateTime(result.issuedAt)).toBe(true);
      // expiresAt is 10 minutes after issuedAt
      expect(result.expiresAt.toUnixInteger() - result.issuedAt.toUnixInteger()).toBe(600);
    });

    it('caches the payload under the registration id and the hash:salt key', async () => {
      await service.registerPasswordFactor('strong-pass');

      // Two cache.set calls: payload under registrationId, registrationId under `${hash}:${salt}`.
      expect(cache.set).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = vi.mocked(cache.set).mock.calls;
      expect(firstCall![0]).toMatch(/^password_factor_registration_/);
      const payload = JSON.parse(firstCall![1] as string);
      expect(payload.hash).toBeTruthy();
      expect(payload.salt).toBeTruthy();
      expect(payload.id).toBeTruthy();
      expect(secondCall![0]).toBe(`password_factor_registration_${payload.hash}:${payload.salt}`);
      expect(secondCall![1]).toBe(payload.id);
    });

    it('returns the existing registration with alreadyRegistered=true when one is cached for the same password', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValueOnce('reg-id-1').mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.registerPasswordFactor('strong-pass');

      expect(result.registrationId).toBe('reg-id-1');
      expect(result.alreadyRegistered).toBe(true);
      expect(result.expiresAt.toUnixInteger()).toBe(payload.expiresAt);
      expect(result.issuedAt.toUnixInteger()).toBe(payload.issuedAt);
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('createPasswordFactorFromRegistration', () => {
    it('throws 404 when the registration does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.createPasswordFactorFromRegistration('actor-1', 'missing-reg')).rejects.toMatchObject({
        statusCode: 404,
        details: { registrationId: 'not found' },
      });
      expect(repo.createFactor).not.toHaveBeenCalled();
    });

    it('persists the cached hash/salt against the actor and returns the factor', async () => {
      const payload = makeRegistrationPayload({ hash: 'cached-hash', salt: 'cached-salt' });
      const factor = makePasswordFactor({ id: 'new-factor' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(factor);

      const result = await service.createPasswordFactorFromRegistration('actor-1', 'reg-id-1');

      expect(result).toBe(factor);
      expect(repo.createFactor).toHaveBeenCalledWith('actor-1', { hash: 'cached-hash', salt: 'cached-salt', needsReset: false });
    });

    it('deletes the cached registration entries after persisting', async () => {
      const payload = makeRegistrationPayload({ hash: 'cached-hash', salt: 'cached-salt' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makePasswordFactor());

      await service.createPasswordFactorFromRegistration('actor-1', 'reg-id-1');

      expect(cache.delete).toHaveBeenCalledWith('password_factor_registration_reg-id-1');
      expect(cache.delete).toHaveBeenCalledWith('password_factor_registration_cached-hash:cached-salt');
    });
  });

  describe('updatePasswordFactor', () => {
    it('throws when ensureStrength rejects', async () => {
      strengthProvider.ensureStrength = vi.fn().mockRejectedValue(httpError(400));

      await expect(service.updatePasswordFactor('actor-1', 'weak')).rejects.toMatchObject({ statusCode: 400 });
      expect(repo.getFactor).not.toHaveBeenCalled();
    });

    it('throws 404 when there is no existing factor', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(undefined);

      await expect(service.updatePasswordFactor('actor-1', 'strong-pass')).rejects.toMatchObject({
        statusCode: 404,
        details: { actorId: 'Password factor not found' },
      });
    });

    it('throws 400 when the new password matches a previous one', async () => {
      const previous = hashPassword('strong-pass');
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor());
      repo.listPreviousPasswords = vi.fn().mockResolvedValue([previous]);

      await expect(service.updatePasswordFactor('actor-1', 'strong-pass')).rejects.toMatchObject({
        statusCode: 400,
        details: { password: 'Password is the same as a previous one' },
      });
      expect(repo.updateFactor).not.toHaveBeenCalled();
    });

    it('updates the factor and returns it when the password is novel', async () => {
      const updated = makePasswordFactor({ id: 'updated-factor' });
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor());
      repo.listPreviousPasswords = vi.fn().mockResolvedValue([hashPassword('something-else')]);
      repo.updateFactor = vi.fn().mockResolvedValue(updated);

      const result = await service.updatePasswordFactor('actor-1', 'strong-pass', true);

      expect(result).toBe(updated);
      expect(strengthProvider.ensureStrength).toHaveBeenCalledWith('strong-pass');
      expect(repo.listPreviousPasswords).toHaveBeenCalledWith('actor-1', 10);
      const [actorId, value] = vi.mocked(repo.updateFactor).mock.calls[0]!;
      expect(actorId).toBe('actor-1');
      expect(value.hash).toBeTruthy();
      expect(value.needsReset).toBe(true);
    });
  });

  describe('deleteFactor', () => {
    it('delegates to the repository', async () => {
      await service.deleteFactor('actor-1');
      expect(repo.deleteFactor).toHaveBeenCalledWith('actor-1', 'actor-1');
    });
  });

  describe('verifyPassword', () => {
    it('throws 429 when the rate limiter rejects', async () => {
      rateLimiter.consume = vi.fn().mockRejectedValue(new Error('rate limited'));
      await expect(service.verifyPassword('actor-1', 'strong-pass')).rejects.toMatchObject({ statusCode: 429 });
      expect(repo.getFactor).not.toHaveBeenCalled();
    });

    it('does not consult the strength provider on verify', async () => {
      const value = hashPassword('strong-pass');
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor({ value }));

      await service.verifyPassword('actor-1', 'strong-pass');

      expect(strengthProvider.ensureStrength).not.toHaveBeenCalled();
      expect(strengthProvider.checkStrength).not.toHaveBeenCalled();
    });

    it('throws 401 when the factor does not exist', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(undefined);
      await expect(service.verifyPassword('actor-1', 'strong-pass')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when the factor is inactive', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor({ active: false }));
      await expect(service.verifyPassword('actor-1', 'strong-pass')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when the factor needs reset', async () => {
      const value = hashPassword('strong-pass');
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor({ needsReset: true, value }));
      await expect(service.verifyPassword('actor-1', 'strong-pass')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when the password does not match', async () => {
      const value = hashPassword('actual-password');
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor({ value }));
      await expect(service.verifyPassword('actor-1', 'wrong-password')).rejects.toMatchObject({ statusCode: 401 });
      expect(rateLimiter.reward).not.toHaveBeenCalled();
    });

    it('returns the verified factor and rewards the rate limiter on success', async () => {
      const value = hashPassword('strong-pass');
      const factor = makePasswordFactor({ id: 'verified-factor', value });
      repo.getFactor = vi.fn().mockResolvedValue(factor);

      const result = await service.verifyPassword('actor-1', 'strong-pass');

      expect(result).toBe(factor);
      expect(rateLimiter.consume).toHaveBeenCalledWith('actor-1');
      expect(rateLimiter.reward).toHaveBeenCalledWith('actor-1');
    });
  });

  describe('changePassword', () => {
    it('throws when ensureStrength rejects', async () => {
      strengthProvider.ensureStrength = vi.fn().mockRejectedValue(httpError(400));

      await expect(service.changePassword('actor-1', 'weak')).rejects.toMatchObject({ statusCode: 400 });
      expect(repo.getFactor).not.toHaveBeenCalled();
    });

    it('throws 404 when the factor does not exist', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(undefined);
      await expect(service.changePassword('actor-1', 'strong-pass')).rejects.toMatchObject({
        statusCode: 404,
        details: { actorId: 'Password factor not found' },
      });
    });

    it('updates the factor with needsReset cleared and returns it', async () => {
      const updated = makePasswordFactor({ id: 'changed-factor' });
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor({ needsReset: true }));
      repo.updateFactor = vi.fn().mockResolvedValue(updated);

      const result = await service.changePassword('actor-1', 'strong-pass');

      expect(result).toBe(updated);
      expect(strengthProvider.ensureStrength).toHaveBeenCalledWith('strong-pass');
      const [actorId, value] = vi.mocked(repo.updateFactor).mock.calls[0]!;
      expect(actorId).toBe('actor-1');
      expect(value.hash).toBeTruthy();
      expect(value.needsReset).toBe(false);
    });
  });

  describe('hasPendingRegistration', () => {
    it('returns true when the registration is cached', async () => {
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(makeRegistrationPayload()));
      await expect(service.hasPendingRegistration('reg-id-1')).resolves.toBe(true);
    });

    it('returns false when the registration is not cached', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.hasPendingRegistration('missing-reg')).resolves.toBe(false);
    });

    it('looks up under the registration cache key namespace', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await service.hasPendingRegistration('reg-id-1');
      expect(cache.get).toHaveBeenCalledWith('password_factor_registration_reg-id-1');
    });
  });

  describe('checkPasswordStrength', () => {
    it('delegates to the strength provider and returns its result', async () => {
      const result = { valid: false, score: 1, feedback: { warning: 'too short', suggestions: ['use more characters'] } };
      strengthProvider.checkStrength = vi.fn().mockResolvedValue(result);

      await expect(service.checkPasswordStrength('weak', 'alice@example.com', 1990)).resolves.toBe(result);
      expect(strengthProvider.checkStrength).toHaveBeenCalledWith('weak', 'alice@example.com', 1990);
    });
  });

  describe('clearRateLimit', () => {
    it('delegates to the rate limiter', async () => {
      await service.clearRateLimit('actor-1');
      expect(rateLimiter.delete).toHaveBeenCalledWith('actor-1');
    });
  });

  describe('ensurePasswordStrength', () => {
    it('delegates to the strength provider', async () => {
      strengthProvider.ensureStrength = vi.fn().mockResolvedValue(undefined);

      await service.ensurePasswordStrength('strong-pass', 'alice@example.com');

      expect(strengthProvider.ensureStrength).toHaveBeenCalledWith('strong-pass', 'alice@example.com');
    });

    it('propagates the error thrown by the strength provider', async () => {
      strengthProvider.ensureStrength = vi.fn().mockRejectedValue(httpError(400).withDetails({ password: 'too weak' }));

      await expect(service.ensurePasswordStrength('weak')).rejects.toMatchObject({
        statusCode: 400,
        details: { password: 'too weak' },
      });
    });
  });
});
