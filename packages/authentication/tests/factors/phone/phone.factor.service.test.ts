import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@maroonedsoftware/utilities', () => ({
  isPhoneE164: vi.fn().mockReturnValue(true),
}));

import { isPhoneE164 } from '@maroonedsoftware/utilities';
import { PhoneFactorService } from '../../../src/factors/phone/phone.factor.service.js';
import type { PhoneFactorRepository, PhoneFactor } from '../../../src/factors/phone/phone.factor.repository.js';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { Duration, DateTime } from 'luxon';

const makeCacheProvider = () =>
  ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(null),
  }) as unknown as CacheProvider;

const makeRepository = () =>
  ({
    createFactor: vi.fn(),
    findFactor: vi.fn().mockResolvedValue(undefined),
    getFactor: vi.fn(),
    deleteFactor: vi.fn(),
  }) as unknown as PhoneFactorRepository;

const makePhoneFactor = (overrides: Partial<PhoneFactor> = {}): PhoneFactor => ({
  id: 'factor-1',
  actorId: 'actor-1',
  active: true,
  value: '+12025550123',
  ...overrides,
});

const makeOptions = () => ({
  otpExpiration: Duration.fromObject({ minutes: 10 }),
});

const makeRegistrationPayload = (overrides = {}) => ({
  id: 'reg-id-1',
  actorId: 'actor-1',
  value: '+12025550123',
  expiresAt: Math.floor(Date.now() / 1000) + 600,
  issuedAt: Math.floor(Date.now() / 1000),
  ...overrides,
});

describe('PhoneFactorService', () => {
  let cache: ReturnType<typeof makeCacheProvider>;
  let repo: ReturnType<typeof makeRepository>;
  let service: PhoneFactorService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPhoneE164).mockReturnValue(true);
    cache = makeCacheProvider();
    repo = makeRepository();
    service = new PhoneFactorService(makeOptions(), repo, cache);
  });

  describe('registerPhoneFactor', () => {
    it('throws 400 for an invalid E.164 phone number', async () => {
      vi.mocked(isPhoneE164).mockReturnValue(false);
      await expect(service.registerPhoneFactor('actor-1', 'not-a-phone')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'invalid E.164 format' },
      });
    });

    it('validates the phone number via isPhoneE164', async () => {
      await service.registerPhoneFactor('actor-1', '+12025550123');
      expect(isPhoneE164).toHaveBeenCalledWith('+12025550123');
    });

    it('returns the existing pending registration when one is already cached', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn()
        .mockResolvedValueOnce('reg-id-1')
        .mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.registerPhoneFactor('actor-1', '+12025550123');

      expect(result.registrationId).toBe('reg-id-1');
      expect(DateTime.isDateTime(result.expiresAt)).toBe(true);
      expect(result.expiresAt.toUnixInteger()).toBe(payload.expiresAt);
      expect(repo.findFactor).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('throws 409 when the phone number is already registered as a factor', async () => {
      repo.findFactor = vi.fn().mockResolvedValue(makePhoneFactor());
      await expect(service.registerPhoneFactor('actor-1', '+12025550123')).rejects.toMatchObject({
        statusCode: 409,
        details: { value: 'already registered' },
      });
    });

    it('checks the repository for an existing factor after confirming no pending registration', async () => {
      await service.registerPhoneFactor('actor-1', '+12025550123');
      expect(repo.findFactor).toHaveBeenCalledWith('actor-1', '+12025550123');
    });

    it('caches the registration payload under a random key', async () => {
      await service.registerPhoneFactor('actor-1', '+12025550123');
      const calls = vi.mocked(cache.set).mock.calls as unknown as [string, string][];
      const payloadCall = calls.find(([, value]) => {
        try {
          return !!(value && JSON.parse(value).actorId);
        } catch {
          return false;
        }
      });
      expect(payloadCall).toBeDefined();
      const payload = JSON.parse(payloadCall![1]);
      expect(payload.actorId).toBe('actor-1');
      expect(payload.value).toBe('+12025550123');
    });

    it('caches a lookup entry mapping actor+value to registrationId', async () => {
      await service.registerPhoneFactor('actor-1', '+12025550123');
      const calls = vi.mocked(cache.set).mock.calls as unknown as [string, string][];
      const keys = calls.map(([key]) => key);
      expect(keys.some((k: string) => k.includes('actor-1_+12025550123'))).toBe(true);
    });

    it('stores the payload and lookup under separate cache keys (two set calls)', async () => {
      await service.registerPhoneFactor('actor-1', '+12025550123');
      expect(cache.set).toHaveBeenCalledTimes(2);
    });

    it('returns a registrationId and expiresAt as a DateTime', async () => {
      const result = await service.registerPhoneFactor('actor-1', '+12025550123');
      expect(result.registrationId).toBeTruthy();
      expect(DateTime.isDateTime(result.expiresAt)).toBe(true);
    });
  });

  describe('createPhoneFactorFromRegistration', () => {
    it('throws 404 when the registration does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.createPhoneFactorFromRegistration('actor-1', 'missing-reg')).rejects.toMatchObject({
        statusCode: 404,
        details: { registrationId: 'not found' },
      });
    });

    it('throws 400 when the actorId does not match the registration', async () => {
      const payload = makeRegistrationPayload({ actorId: 'actor-1' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      await expect(service.createPhoneFactorFromRegistration('actor-2', 'reg-id-1')).rejects.toMatchObject({
        statusCode: 400,
        details: { actorId: 'invalid actor' },
      });
    });

    it('persists the factor with the phone number from the registration', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makePhoneFactor());

      await service.createPhoneFactorFromRegistration('actor-1', 'reg-id-1');

      expect(repo.createFactor).toHaveBeenCalledWith('actor-1', '+12025550123');
    });

    it('returns the new factor id on success', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makePhoneFactor({ id: 'new-factor-id' }));

      const result = await service.createPhoneFactorFromRegistration('actor-1', 'reg-id-1');

      expect(result).toBe('new-factor-id');
    });
  });
});
