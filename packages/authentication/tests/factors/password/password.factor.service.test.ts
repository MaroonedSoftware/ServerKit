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
import { httpError } from '@maroonedsoftware/errors';

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
  }) as unknown as RateLimiterCompatibleAbstract;

const makeStrengthProvider = () =>
  ({
    checkStrength: vi.fn().mockResolvedValue({ valid: true, score: 4, feedback: { warning: '', suggestions: [] } }),
    ensureStrength: vi.fn().mockResolvedValue(undefined),
  }) as unknown as PasswordStrengthProvider;

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
  let service: PasswordFactorService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepository();
    rateLimiter = makeRateLimiter();
    strengthProvider = makeStrengthProvider();
    service = new PasswordFactorService(repo, rateLimiter, strengthProvider);
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

    it('creates a new factor and returns its id', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(undefined);
      repo.createFactor = vi.fn().mockResolvedValue(makePasswordFactor({ id: 'new-factor' }));

      const id = await service.createPasswordFactor('actor-1', 'strong-pass', true);

      expect(id).toBe('new-factor');
      expect(strengthProvider.ensureStrength).toHaveBeenCalledWith('strong-pass');
      expect(repo.createFactor).toHaveBeenCalledTimes(1);
      const [actorId, value, needsReset] = vi.mocked(repo.createFactor).mock.calls[0]!;
      expect(actorId).toBe('actor-1');
      expect(value.hash).toBeTruthy();
      expect(value.salt).toBeTruthy();
      expect(needsReset).toBe(true);
    });

    it('defaults needsReset to false', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(undefined);
      repo.createFactor = vi.fn().mockResolvedValue(makePasswordFactor());

      await service.createPasswordFactor('actor-1', 'strong-pass');

      expect(vi.mocked(repo.createFactor).mock.calls[0]![2]).toBe(false);
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

    it('updates the factor and returns its id when the password is novel', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor());
      repo.listPreviousPasswords = vi.fn().mockResolvedValue([hashPassword('something-else')]);
      repo.updateFactor = vi.fn().mockResolvedValue(makePasswordFactor({ id: 'updated-factor' }));

      const id = await service.updatePasswordFactor('actor-1', 'strong-pass', true);

      expect(id).toBe('updated-factor');
      expect(strengthProvider.ensureStrength).toHaveBeenCalledWith('strong-pass');
      expect(repo.listPreviousPasswords).toHaveBeenCalledWith('actor-1', 10);
      const [actorId, value, needsReset] = vi.mocked(repo.updateFactor).mock.calls[0]!;
      expect(actorId).toBe('actor-1');
      expect(value.hash).toBeTruthy();
      expect(needsReset).toBe(true);
    });
  });

  describe('deleteFactor', () => {
    it('delegates to the repository', async () => {
      await service.deleteFactor('actor-1');
      expect(repo.deleteFactor).toHaveBeenCalledWith('actor-1');
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

    it('returns the factor id and rewards the rate limiter on success', async () => {
      const value = hashPassword('strong-pass');
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor({ id: 'verified-factor', value }));

      const id = await service.verifyPassword('actor-1', 'strong-pass');

      expect(id).toBe('verified-factor');
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

    it('updates the factor with needsReset cleared and returns its id', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makePasswordFactor({ needsReset: true }));
      repo.updateFactor = vi.fn().mockResolvedValue(makePasswordFactor({ id: 'changed-factor' }));

      const id = await service.changePassword('actor-1', 'strong-pass');

      expect(id).toBe('changed-factor');
      expect(strengthProvider.ensureStrength).toHaveBeenCalledWith('strong-pass');
      const [actorId, value, needsReset] = vi.mocked(repo.updateFactor).mock.calls[0]!;
      expect(actorId).toBe('actor-1');
      expect(value.hash).toBeTruthy();
      expect(needsReset).toBe(false);
    });
  });
});
