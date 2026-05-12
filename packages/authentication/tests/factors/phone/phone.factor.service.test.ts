import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PhoneFactorService } from '../../../src/factors/phone/phone.factor.service.js';
import type { PhoneFactorRepository, PhoneFactor } from '../../../src/factors/phone/phone.factor.repository.js';
import type { OtpProvider } from '../../../src/providers/otp.provider.js';
import type { PolicyService } from '@maroonedsoftware/policies';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { Duration, DateTime } from 'luxon';

const makeCacheProvider = () =>
  ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(null),
  }) as unknown as CacheProvider;

const makeOtpProvider = () =>
  ({
    createSecret: vi.fn().mockReturnValue('TESTSECRET'),
    generate: vi.fn().mockReturnValue('123456'),
    validate: vi.fn().mockReturnValue(true),
  }) as unknown as OtpProvider;

const makeRepository = () =>
  ({
    createFactor: vi.fn(),
    findFactor: vi.fn().mockResolvedValue(undefined),
    getFactor: vi.fn(),
    deleteFactor: vi.fn(),
  }) as unknown as PhoneFactorRepository;

const makePolicyService = () =>
  ({
    check: vi.fn().mockResolvedValue({ allowed: true }),
    assert: vi.fn().mockResolvedValue(undefined),
  }) as unknown as PolicyService;

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
  secret: 'TESTSECRET',
  code: '123456',
  expiresAt: DateTime.utc().plus({ minutes: 10 }).toUnixInteger(),
  issuedAt: DateTime.utc().toUnixInteger(),
  value: '+12025550123',
  ...overrides,
});

const makeChallengePayload = (overrides = {}) => ({
  id: 'chal-id-1',
  secret: 'TESTSECRET',
  code: '123456',
  expiresAt: DateTime.utc().plus({ minutes: 10 }).toUnixInteger(),
  issuedAt: DateTime.utc().toUnixInteger(),
  actorId: 'actor-1',
  factorId: 'factor-1',
  ...overrides,
});

describe('PhoneFactorService', () => {
  let cache: ReturnType<typeof makeCacheProvider>;
  let otpProvider: ReturnType<typeof makeOtpProvider>;
  let repo: ReturnType<typeof makeRepository>;
  let policyService: ReturnType<typeof makePolicyService>;
  let service: PhoneFactorService;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCacheProvider();
    otpProvider = makeOtpProvider();
    repo = makeRepository();
    policyService = makePolicyService();
    service = new PhoneFactorService(makeOptions(), repo, otpProvider, cache, policyService);
  });

  describe('registerPhoneFactor', () => {
    it("throws 400 with E.164-format message when the phone.allowed policy denies with reason 'invalid_format'", async () => {
      vi.mocked(policyService.check).mockResolvedValue({ allowed: false, reason: 'invalid_format' });
      await expect(service.registerPhoneFactor('not-a-phone')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'invalid phone number, expected E.164 format' },
      });
    });

    it("throws 400 with 'phone number is not allowed' when the phone.allowed policy denies with reason 'deny_list'", async () => {
      vi.mocked(policyService.check).mockResolvedValue({ allowed: false, reason: 'deny_list' });
      await expect(service.registerPhoneFactor('+12025550123')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'phone number is not allowed' },
      });
    });

    it('passes through a custom deny reason string unchanged', async () => {
      vi.mocked(policyService.check).mockResolvedValue({ allowed: false, reason: 'region_blocked' });
      await expect(service.registerPhoneFactor('+12025550123')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'region_blocked' },
      });
    });

    it("invokes the 'auth.factor.phone.allowed' policy with the phone value", async () => {
      await service.registerPhoneFactor('+12025550123');
      expect(policyService.check).toHaveBeenCalledWith('auth.factor.phone.allowed', { value: '+12025550123' });
    });

    it('returns the existing pending registration with alreadyRegistered=true when one is cached for the value', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn()
        .mockResolvedValueOnce('reg-id-1')
        .mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.registerPhoneFactor('+12025550123');

      expect(result.registrationId).toBe('reg-id-1');
      expect(result.code).toBe('123456');
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
      expect(payload.secret).toBe('TESTSECRET');
      expect(payload.code).toBe('123456');
      expect(secondCall![0]).toBe('phone_factor_registration_+12025550123');
      expect(secondCall![1]).toBe(payload.id);
    });

    it('uses the caller-supplied registrationId when persisting a fresh registration', async () => {
      const result = await service.registerPhoneFactor('+12025550123', 'caller-supplied-id');

      expect(result.registrationId).toBe('caller-supplied-id');
      const [firstCall] = vi.mocked(cache.set).mock.calls;
      expect(firstCall![0]).toBe('phone_factor_registration_caller-supplied-id');
    });

    it('returns registrationId, code, expiresAt, issuedAt, and alreadyRegistered=false on a fresh registration', async () => {
      const result = await service.registerPhoneFactor('+12025550123');
      expect(result.code).toBe('123456');
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
      await expect(service.createPhoneFactorFromRegistration('actor-1', 'missing-reg', '123456')).rejects.toMatchObject({
        statusCode: 404,
        details: { registrationId: 'not found' },
      });
    });

    it('throws 400 when the OTP code is invalid', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      vi.mocked(otpProvider.validate).mockReturnValue(false);

      await expect(service.createPhoneFactorFromRegistration('actor-1', 'reg-id-1', 'wrong')).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'invalid code' },
      });
    });

    it('persists the factor against the supplied actorId with the phone number from the registration', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makePhoneFactor());

      await service.createPhoneFactorFromRegistration('actor-1', 'reg-id-1', '123456');

      expect(repo.createFactor).toHaveBeenCalledWith('actor-1', '+12025550123');
    });

    it('returns the new factor on success', async () => {
      const payload = makeRegistrationPayload();
      const factor = makePhoneFactor({ id: 'new-factor-id' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(factor);

      const result = await service.createPhoneFactorFromRegistration('actor-1', 'reg-id-1', '123456');

      expect(result).toBe(factor);
    });

    it('deletes the cached registration entries after a successful registration', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makePhoneFactor());

      await service.createPhoneFactorFromRegistration('actor-1', 'reg-id-1', '123456');

      expect(cache.delete).toHaveBeenCalledWith('phone_factor_registration_reg-id-1');
      expect(cache.delete).toHaveBeenCalledWith('phone_factor_registration_+12025550123');
    });
  });

  describe('issuePhoneChallenge', () => {
    it('throws 404 when the factor does not exist', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(null);
      await expect(service.issuePhoneChallenge('actor-1', 'factor-1')).rejects.toMatchObject({
        statusCode: 404,
        details: { factorId: 'not found' },
      });
    });

    it('throws 404 when the factor is not active', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makePhoneFactor({ active: false }));
      await expect(service.issuePhoneChallenge('actor-1', 'factor-1')).rejects.toMatchObject({
        statusCode: 404,
        details: { factorId: 'not found' },
      });
    });

    it('returns phone, challengeId, code, expiresAt, issuedAt, and alreadyIssued=false on a fresh challenge', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makePhoneFactor());

      const result = await service.issuePhoneChallenge('actor-1', 'factor-1');

      expect(result.phone).toBe('+12025550123');
      expect(result.challengeId).toBeTruthy();
      expect(result.code).toBe('123456');
      expect(DateTime.isDateTime(result.expiresAt)).toBe(true);
      expect(DateTime.isDateTime(result.issuedAt)).toBe(true);
      expect(result.alreadyIssued).toBe(false);
    });

    it('caches the challenge payload under both the challenge id and actor+factor keys', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makePhoneFactor());

      await service.issuePhoneChallenge('actor-1', 'factor-1');

      // Two cache.set calls: one for the payload, one for the actor_factor → id lookup
      expect(cache.set).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = vi.mocked(cache.set).mock.calls;
      const [payloadKey, payloadJson] = firstCall!;
      expect(payloadKey).toMatch(/^phone_factor_challenge_/);
      const payload = JSON.parse(payloadJson as string);
      expect(payload.actorId).toBe('actor-1');
      expect(payload.factorId).toBe('factor-1');
      expect(secondCall![0]).toBe('phone_factor_challenge_actor-1_factor-1');
    });

    it('returns the existing pending challenge with alreadyIssued=true when one is cached', async () => {
      const payload = makeChallengePayload();
      repo.getFactor = vi.fn().mockResolvedValue(makePhoneFactor());
      cache.get = vi.fn().mockResolvedValueOnce('chal-id-1').mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.issuePhoneChallenge('actor-1', 'factor-1');

      expect(result.phone).toBe('+12025550123');
      expect(result.challengeId).toBe('chal-id-1');
      expect(result.code).toBe('123456');
      expect(result.alreadyIssued).toBe(true);
      expect(result.expiresAt.toUnixInteger()).toBe(payload.expiresAt);
      expect(result.issuedAt.toUnixInteger()).toBe(payload.issuedAt);
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('verifyPhoneChallenge', () => {
    it('throws 404 when the challenge does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.verifyPhoneChallenge('missing-id', '123456')).rejects.toMatchObject({
        statusCode: 404,
        details: { challengeId: 'not found' },
      });
    });

    it('throws 401 when the factor has been deleted since the challenge was issued', async () => {
      const payload = makeChallengePayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(undefined);

      await expect(service.verifyPhoneChallenge('chal-id-1', '123456')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when the factor has been deactivated since the challenge was issued', async () => {
      const payload = makeChallengePayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(makePhoneFactor({ active: false }));

      await expect(service.verifyPhoneChallenge('chal-id-1', '123456')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 400 when the OTP code is invalid', async () => {
      const payload = makeChallengePayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(makePhoneFactor());
      vi.mocked(otpProvider.validate).mockReturnValue(false);

      await expect(service.verifyPhoneChallenge('chal-id-1', 'wrong')).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'invalid code' },
      });
    });

    it('returns the verified factor on a valid code', async () => {
      const factor = makePhoneFactor();
      const payload = makeChallengePayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(factor);
      vi.mocked(otpProvider.validate).mockReturnValue(true);

      const result = await service.verifyPhoneChallenge('chal-id-1', '123456');

      expect(result).toBe(factor);
    });

    it('deletes the cached challenge entries after a successful verification', async () => {
      const payload = makeChallengePayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(makePhoneFactor());
      vi.mocked(otpProvider.validate).mockReturnValue(true);

      await service.verifyPhoneChallenge('chal-id-1', '123456');

      expect(cache.delete).toHaveBeenCalledWith('phone_factor_challenge_chal-id-1');
      expect(cache.delete).toHaveBeenCalledWith('phone_factor_challenge_actor-1_factor-1');
    });
  });

  describe('hasPendingChallenge', () => {
    it('returns true when the challenge is cached', async () => {
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(makeChallengePayload()));
      await expect(service.hasPendingChallenge('chal-id-1')).resolves.toBe(true);
    });

    it('returns false when the challenge is not cached', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.hasPendingChallenge('missing-id')).resolves.toBe(false);
    });

    it('looks up under the challenge cache key namespace', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await service.hasPendingChallenge('chal-id-1');
      expect(cache.get).toHaveBeenCalledWith('phone_factor_challenge_chal-id-1');
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
