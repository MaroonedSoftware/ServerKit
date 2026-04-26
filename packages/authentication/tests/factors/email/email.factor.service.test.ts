import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@maroonedsoftware/utilities', () => ({
  isEmail: vi.fn(),
  binarySearch: vi.fn(),
}));

import { isEmail, binarySearch } from '@maroonedsoftware/utilities';
import { EmailFactorService } from '../../../src/factors/email/email.factor.service.js';
import type { EmailFactorRepository, EmailFactor } from '../../../src/factors/email/email.factor.repository.js';
import type { OtpProvider } from '../../../src/providers/otp.provider.js';
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

const makeEmailFactorRepository = () =>
  ({
    createFactor: vi.fn(),
    doesEmailExist: vi.fn().mockResolvedValue(false),
    isDomainInviteOnly: vi.fn().mockResolvedValue(false),
    getFactor: vi.fn(),
    deleteFactor: vi.fn(),
  }) as unknown as EmailFactorRepository;

const makeEmailFactor = (overrides: Partial<EmailFactor> = {}): EmailFactor => ({
  id: 'factor-1',
  actorId: 'actor-1',
  active: true,
  value: 'user@example.com',
  ...overrides,
});

const makeOptions = () => ({
  denyList: ['disposable.com', 'tempmail.org'],
  otpExpiration: Duration.fromObject({ minutes: 10 }),
  magiclinkExpiration: Duration.fromObject({ minutes: 30 }),
});

const makeRegistrationPayload = (overrides = {}) => ({
  id: 'reg-id-1',
  verificationMethod: 'code' as const,
  secret: 'TESTSECRET',
  code: '123456',
  expiresAt: DateTime.utc().plus({ minutes: 10 }).toUnixInteger(),
  issuedAt: DateTime.utc().toUnixInteger(),
  value: 'user@example.com',
  ...overrides,
});

const makeVerificationPayload = (overrides = {}) => ({
  id: 'ver-id-1',
  verificationMethod: 'code' as const,
  secret: 'TESTSECRET',
  code: '123456',
  expiresAt: DateTime.utc().plus({ minutes: 10 }).toUnixInteger(),
  issuedAt: DateTime.utc().toUnixInteger(),
  actorId: 'actor-1',
  factorId: 'factor-1',
  ...overrides,
});

describe('EmailFactorService', () => {
  let cache: ReturnType<typeof makeCacheProvider>;
  let otpProvider: ReturnType<typeof makeOtpProvider>;
  let repo: ReturnType<typeof makeEmailFactorRepository>;
  let service: EmailFactorService;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCacheProvider();
    otpProvider = makeOtpProvider();
    repo = makeEmailFactorRepository();
    service = new EmailFactorService(makeOptions(), repo, otpProvider, cache);

    vi.mocked(isEmail).mockReturnValue(true);
    vi.mocked(binarySearch).mockReturnValue(false);
  });

  describe('registerEmailFactor', () => {
    it('throws 400 when the email format is invalid', async () => {
      vi.mocked(isEmail).mockReturnValue(false);
      await expect(service.registerEmailFactor('not-an-email', 'code')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'invalid email format' },
      });
    });

    it('returns the existing pending registration with alreadyRegistered=true when one is cached', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValueOnce('reg-id-1').mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.registerEmailFactor('user@example.com', 'code');

      expect(result.registrationId).toBe('reg-id-1');
      expect(result.code).toBe('123456');
      expect(result.alreadyRegistered).toBe(true);
      expect(DateTime.isDateTime(result.expiresAt)).toBe(true);
      expect(result.expiresAt.toUnixInteger()).toBe(payload.expiresAt);
      expect(DateTime.isDateTime(result.issuedAt)).toBe(true);
      expect(result.issuedAt.toUnixInteger()).toBe(payload.issuedAt);
    });

    it('skips deny list, invite-only, and existence checks when a pending registration is cached', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValueOnce('reg-id-1').mockResolvedValueOnce(JSON.stringify(payload));
      vi.mocked(binarySearch).mockReturnValue(true);
      repo.isDomainInviteOnly = vi.fn().mockResolvedValue(true);
      repo.doesEmailExist = vi.fn().mockResolvedValue(true);

      const result = await service.registerEmailFactor('user@example.com', 'code');

      expect(result.alreadyRegistered).toBe(true);
      expect(binarySearch).not.toHaveBeenCalled();
      expect(repo.isDomainInviteOnly).not.toHaveBeenCalled();
      expect(repo.doesEmailExist).not.toHaveBeenCalled();
    });

    it('throws 400 when the domain is on the deny list', async () => {
      vi.mocked(binarySearch).mockReturnValue(true);
      await expect(service.registerEmailFactor('user@disposable.com', 'code')).rejects.toMatchObject({
        statusCode: 400,
        details: { email: 'Must not be a disposable email' },
      });
    });

    it('throws 403 when the email domain is invite-only', async () => {
      repo.isDomainInviteOnly = vi.fn().mockResolvedValue(true);
      await expect(service.registerEmailFactor('user@invite-only.com', 'code')).rejects.toMatchObject({
        statusCode: 403,
        details: { email: 'Must be invited to register' },
      });
      expect(repo.isDomainInviteOnly).toHaveBeenCalledWith('invite-only.com');
    });

    it('checks the deny list before checking invite-only', async () => {
      vi.mocked(binarySearch).mockReturnValue(true);
      repo.isDomainInviteOnly = vi.fn().mockResolvedValue(true);

      await expect(service.registerEmailFactor('user@disposable.com', 'code')).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(repo.isDomainInviteOnly).not.toHaveBeenCalled();
    });

    it('checks invite-only before checking whether the email already exists', async () => {
      repo.isDomainInviteOnly = vi.fn().mockResolvedValue(true);
      repo.doesEmailExist = vi.fn().mockResolvedValue(true);

      await expect(service.registerEmailFactor('user@invite-only.com', 'code')).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(repo.doesEmailExist).not.toHaveBeenCalled();
    });

    it('throws 409 when doesEmailExist returns true', async () => {
      repo.doesEmailExist = vi.fn().mockResolvedValue(true);
      await expect(service.registerEmailFactor('user@example.com', 'code')).rejects.toMatchObject({
        statusCode: 409,
        details: { method: 'already registered' },
      });
    });

    it('creates a registration and returns registrationId, code, expiresAt, issuedAt, and alreadyRegistered=false', async () => {
      const result = await service.registerEmailFactor('user@example.com', 'code');

      expect(result.code).toBe('123456');
      expect(result.registrationId).toBeTruthy();
      expect(DateTime.isDateTime(result.expiresAt)).toBe(true);
      expect(DateTime.isDateTime(result.issuedAt)).toBe(true);
      // expiresAt is otpExpiration after issuedAt.
      expect(result.expiresAt.toUnixInteger() - result.issuedAt.toUnixInteger()).toBe(
        Math.round(makeOptions().otpExpiration.as('seconds')),
      );
      expect(result.alreadyRegistered).toBe(false);
    });

    it('caches the registration payload under the registration id and value keys', async () => {
      await service.registerEmailFactor('user@example.com', 'code');

      // Two cache.set calls: one for the payload, one for the value → id lookup
      expect(cache.set).toHaveBeenCalledTimes(2);
    });

    it('uses magic link expiration for magiclink method', async () => {
      await service.registerEmailFactor('user@example.com', 'magiclink');

      // Ensure a registration was cached (secret is empty for magiclink)
      expect(cache.set).toHaveBeenCalled();
      const [firstCall] = vi.mocked(cache.set).mock.calls;
      const payload = JSON.parse(firstCall![1] as string);
      expect(payload.verificationMethod).toBe('magiclink');
      expect(payload.secret).toBe('');
    });

    it('normalizes the email by trimming whitespace and lowercasing before validating', async () => {
      await service.registerEmailFactor('  USER@Example.COM  ', 'code');

      expect(isEmail).toHaveBeenCalledWith('user@example.com');
    });

    it('persists the normalized email in the registration payload', async () => {
      await service.registerEmailFactor('  USER@Example.COM  ', 'code');

      const [firstCall] = vi.mocked(cache.set).mock.calls;
      const payload = JSON.parse(firstCall![1] as string);
      expect(payload.value).toBe('user@example.com');
    });
  });

  describe('createEmailFactorFromRegistration', () => {
    it('throws 404 when the registration does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.createEmailFactorFromRegistration('actor-1', 'missing-reg', '123456')).rejects.toMatchObject({
        statusCode: 404,
        details: { registrationId: 'not found' },
      });
    });

    it('throws 400 when the OTP code is invalid for a code-based registration', async () => {
      const payload = makeRegistrationPayload({ verificationMethod: 'code' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      vi.mocked(otpProvider.validate).mockReturnValue(false);

      await expect(service.createEmailFactorFromRegistration('actor-1', 'reg-id-1', 'wrong')).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'invalid code' },
      });
    });

    it('throws 400 when the token does not match for a magiclink-based registration', async () => {
      const payload = makeRegistrationPayload({ verificationMethod: 'magiclink', code: 'correct-token' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));

      await expect(service.createEmailFactorFromRegistration('actor-1', 'reg-id-1', 'wrong-token')).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'invalid magiclink' },
      });
    });

    it('calls repository.createFactor and returns the factor for a valid code', async () => {
      const payload = makeRegistrationPayload({ verificationMethod: 'code' });
      const factor = makeEmailFactor();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      vi.mocked(otpProvider.validate).mockReturnValue(true);
      repo.createFactor = vi.fn().mockResolvedValue(factor);

      const result = await service.createEmailFactorFromRegistration('actor-1', 'reg-id-1', '123456');

      expect(repo.createFactor).toHaveBeenCalledWith('actor-1', 'user@example.com');
      expect(result).toBe(factor);
    });

    it('calls repository.createFactor and returns the factor for a valid magiclink', async () => {
      const payload = makeRegistrationPayload({ verificationMethod: 'magiclink', code: 'my-magic-token' });
      const factor = makeEmailFactor();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(factor);

      const result = await service.createEmailFactorFromRegistration('actor-1', 'reg-id-1', 'my-magic-token');

      expect(repo.createFactor).toHaveBeenCalledWith('actor-1', 'user@example.com');
      expect(result).toBe(factor);
    });
  });

  describe('createEmailVerification', () => {
    it('throws 404 when the factor does not exist', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(null);
      await expect(service.createEmailVerification('actor-1', 'factor-1', 'code')).rejects.toMatchObject({
        statusCode: 404,
        details: { factorId: 'not found' },
      });
    });

    it('throws 404 when the factor is not active', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor({ active: false }));
      await expect(service.createEmailVerification('actor-1', 'factor-1', 'code')).rejects.toMatchObject({
        statusCode: 404,
        details: { factorId: 'not found' },
      });
    });

    it('returns email, verificationId, code, and expiresAt for a code-based verification', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor());

      const result = await service.createEmailVerification('actor-1', 'factor-1', 'code');

      expect(result.email).toBe('user@example.com');
      expect(result.verificationId).toBeTruthy();
      expect(result.code).toBe('123456');
    });

    it('caches the verification payload', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor());

      await service.createEmailVerification('actor-1', 'factor-1', 'code');

      expect(cache.set).toHaveBeenCalledOnce();
      const [firstCall] = vi.mocked(cache.set).mock.calls;
      const [key, payloadJson] = firstCall!;
      expect(key).toMatch(/^email_factor_verification_/);
      const payload = JSON.parse(payloadJson as string);
      expect(payload.actorId).toBe('actor-1');
      expect(payload.factorId).toBe('factor-1');
    });

    it('uses magic link for magiclink verification method', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor());

      await service.createEmailVerification('actor-1', 'factor-1', 'magiclink');

      const [firstCall] = vi.mocked(cache.set).mock.calls;
      const payload = JSON.parse(firstCall![1] as string);
      expect(payload.verificationMethod).toBe('magiclink');
    });
  });

  describe('verifyEmailVerification', () => {
    it('throws 404 when the verification does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.verifyEmailVerification('missing-id', '123456')).rejects.toMatchObject({
        statusCode: 404,
        details: { verificationId: 'not found' },
      });
    });

    it('throws 400 when the OTP code is invalid', async () => {
      const payload = makeVerificationPayload({ verificationMethod: 'code' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      vi.mocked(otpProvider.validate).mockReturnValue(false);

      await expect(service.verifyEmailVerification('ver-id-1', 'wrong')).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'invalid code' },
      });
    });

    it('throws 400 when the magic link token does not match', async () => {
      const payload = makeVerificationPayload({ verificationMethod: 'magiclink', code: 'correct-token' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));

      await expect(service.verifyEmailVerification('ver-id-1', 'wrong-token')).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'invalid magiclink' },
      });
    });

    it('returns actorId and factorId for a valid code verification', async () => {
      const payload = makeVerificationPayload({ verificationMethod: 'code' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      vi.mocked(otpProvider.validate).mockReturnValue(true);

      const result = await service.verifyEmailVerification('ver-id-1', '123456');

      expect(result.actorId).toBe('actor-1');
      expect(result.factorId).toBe('factor-1');
    });

    it('returns actorId and factorId for a valid magic link', async () => {
      const payload = makeVerificationPayload({ verificationMethod: 'magiclink', code: 'the-magic-token' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));

      const result = await service.verifyEmailVerification('ver-id-1', 'the-magic-token');

      expect(result.actorId).toBe('actor-1');
      expect(result.factorId).toBe('factor-1');
    });
  });
});
