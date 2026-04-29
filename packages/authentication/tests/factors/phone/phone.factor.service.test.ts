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
      await expect(service.registerPhoneFactor('not-a-phone')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'invalid E.164 format' },
      });
    });

    it('validates the phone number via isPhoneE164', async () => {
      await service.registerPhoneFactor('+12025550123');
      expect(isPhoneE164).toHaveBeenCalledWith('+12025550123');
    });

    it('returns the existing pending registration with alreadyRegistered=true when one is cached for the value', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn()
        .mockResolvedValueOnce('reg-id-1')
        .mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.registerPhoneFactor('+12025550123');

      expect(result.registrationId).toBe('reg-id-1');
      expect(result.value).toBe('+12025550123');
      expect(result.alreadyRegistered).toBe(true);
      expect(DateTime.isDateTime(result.expiresAt)).toBe(true);
      expect(result.expiresAt.toUnixInteger()).toBe(payload.expiresAt);
      expect(DateTime.isDateTime(result.issuedAt)).toBe(true);
      expect(result.issuedAt.toUnixInteger()).toBe(payload.issuedAt);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('returns the existing pending registration with alreadyRegistered=true when looked up by caller-supplied registrationId', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.registerPhoneFactor('+12025550123', 'reg-id-1');

      expect(result.registrationId).toBe('reg-id-1');
      expect(result.alreadyRegistered).toBe(true);
      expect(cache.get).toHaveBeenCalledWith('phone_factor_registration_reg-id-1');
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('caches the registration payload under the registration id and the phone number', async () => {
      await service.registerPhoneFactor('+12025550123');

      // Two cache.set calls: payload under registrationId, registrationId under value.
      expect(cache.set).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = vi.mocked(cache.set).mock.calls;
      const [payloadKey, payloadJson] = firstCall!;
      expect(payloadKey).toMatch(/^phone_factor_registration_/);
      const payload = JSON.parse(payloadJson as string);
      expect(payload.value).toBe('+12025550123');
      expect(payload.id).toBeTruthy();
      expect(secondCall![0]).toBe('phone_factor_registration_+12025550123');
      expect(secondCall![1]).toBe(payload.id);
    });

    it('uses the caller-supplied registrationId when persisting a fresh registration', async () => {
      const result = await service.registerPhoneFactor('+12025550123', 'caller-supplied-id');

      expect(result.registrationId).toBe('caller-supplied-id');
      const [firstCall] = vi.mocked(cache.set).mock.calls;
      expect(firstCall![0]).toBe('phone_factor_registration_caller-supplied-id');
    });

    it('returns value, registrationId, expiresAt, issuedAt, and alreadyRegistered=false on a fresh registration', async () => {
      const result = await service.registerPhoneFactor('+12025550123');
      expect(result.value).toBe('+12025550123');
      expect(result.registrationId).toBeTruthy();
      expect(DateTime.isDateTime(result.expiresAt)).toBe(true);
      expect(DateTime.isDateTime(result.issuedAt)).toBe(true);
      // expiresAt should be otpExpiration after issuedAt.
      expect(result.expiresAt.toUnixInteger() - result.issuedAt.toUnixInteger()).toBe(
        Math.round(makeOptions().otpExpiration.as('seconds')),
      );
      expect(result.alreadyRegistered).toBe(false);
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

    it('persists the factor against the supplied actorId with the phone number from the registration', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makePhoneFactor());

      await service.createPhoneFactorFromRegistration('actor-1', 'reg-id-1');

      expect(repo.createFactor).toHaveBeenCalledWith('actor-1', '+12025550123');
    });

    it('returns the new factor on success', async () => {
      const payload = makeRegistrationPayload();
      const factor = makePhoneFactor({ id: 'new-factor-id' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(factor);

      const result = await service.createPhoneFactorFromRegistration('actor-1', 'reg-id-1');

      expect(result).toBe(factor);
    });

    it('deletes the cached registration entries after a successful registration', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makePhoneFactor());

      await service.createPhoneFactorFromRegistration('actor-1', 'reg-id-1');

      expect(cache.delete).toHaveBeenCalledWith('phone_factor_registration_reg-id-1');
      expect(cache.delete).toHaveBeenCalledWith('phone_factor_registration_+12025550123');
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
      expect(cache.get).toHaveBeenCalledWith('phone_factor_registration_reg-id-1');
    });
  });
});
