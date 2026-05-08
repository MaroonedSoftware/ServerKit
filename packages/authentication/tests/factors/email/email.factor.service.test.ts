import { describe, it, expect, vi, beforeEach } from 'vitest';

import { EmailFactorService } from '../../../src/factors/email/email.factor.service.js';
import type { EmailFactorRepository, EmailFactor } from '../../../src/factors/email/email.factor.repository.js';
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

const makeEmailFactorRepository = () =>
  ({
    createFactor: vi.fn(),
    lookupFactor: vi.fn().mockResolvedValue(undefined),
    isDomainInviteOnly: vi.fn().mockResolvedValue(false),
    getFactor: vi.fn(),
    deleteFactor: vi.fn(),
  }) as unknown as EmailFactorRepository;

const makePolicyService = () =>
  ({
    check: vi.fn().mockResolvedValue({ allowed: true }),
    assert: vi.fn().mockResolvedValue(undefined),
  }) as unknown as PolicyService;

const makeEmailFactor = (overrides: Partial<EmailFactor> = {}): EmailFactor => ({
  id: 'factor-1',
  actorId: 'actor-1',
  active: true,
  value: 'user@example.com',
  ...overrides,
});

const makeOptions = () => ({
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

const makeChallengePayload = (overrides = {}) => ({
  id: 'chal-id-1',
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
  let policyService: ReturnType<typeof makePolicyService>;
  let service: EmailFactorService;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCacheProvider();
    otpProvider = makeOtpProvider();
    repo = makeEmailFactorRepository();
    policyService = makePolicyService();
    service = new EmailFactorService(makeOptions(), repo, otpProvider, cache, policyService);
  });

  describe('registerEmailFactor', () => {
    it("throws 400 with 'invalid email format' when the email_allowed policy denies with reason 'invalid_format'", async () => {
      vi.mocked(policyService.check).mockResolvedValue({ allowed: false, reason: 'invalid_format' });
      await expect(service.registerEmailFactor('not-an-email', 'code')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'invalid email format' },
      });
    });

    it("throws 400 with 'email is not allowed' when the email_allowed policy denies with reason 'deny_list'", async () => {
      vi.mocked(policyService.check).mockResolvedValue({ allowed: false, reason: 'deny_list' });
      await expect(service.registerEmailFactor('user@disposable.com', 'code')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'email is not allowed' },
      });
    });

    it('passes through a custom deny reason string unchanged', async () => {
      vi.mocked(policyService.check).mockResolvedValue({ allowed: false, reason: 'mx_lookup_failed' });
      await expect(service.registerEmailFactor('user@example.com', 'code')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'mx_lookup_failed' },
      });
    });

    it("invokes the 'email_allowed' policy with the normalized email value", async () => {
      await service.registerEmailFactor('  USER@Example.COM  ', 'code');
      expect(policyService.check).toHaveBeenCalledWith('email_allowed', { value: 'user@example.com' });
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

    it('skips invite-only and existence checks when a pending registration is cached', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValueOnce('reg-id-1').mockResolvedValueOnce(JSON.stringify(payload));
      repo.isDomainInviteOnly = vi.fn().mockResolvedValue(true);
      repo.lookupFactor = vi.fn().mockResolvedValue(makeEmailFactor());

      const result = await service.registerEmailFactor('user@example.com', 'code');

      expect(result.alreadyRegistered).toBe(true);
      expect(repo.isDomainInviteOnly).not.toHaveBeenCalled();
      expect(repo.lookupFactor).not.toHaveBeenCalled();
    });

    it('throws 403 when the email domain is invite-only', async () => {
      repo.isDomainInviteOnly = vi.fn().mockResolvedValue(true);
      await expect(service.registerEmailFactor('user@invite-only.com', 'code')).rejects.toMatchObject({
        statusCode: 403,
        details: { email: 'Must be invited to register' },
      });
      expect(repo.isDomainInviteOnly).toHaveBeenCalledWith('invite-only.com');
    });

    it('checks the email_allowed policy before checking invite-only', async () => {
      vi.mocked(policyService.check).mockResolvedValue({ allowed: false, reason: 'deny_list' });
      repo.isDomainInviteOnly = vi.fn().mockResolvedValue(true);

      await expect(service.registerEmailFactor('user@disposable.com', 'code')).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(repo.isDomainInviteOnly).not.toHaveBeenCalled();
    });

    it('checks invite-only before checking whether the email already exists', async () => {
      repo.isDomainInviteOnly = vi.fn().mockResolvedValue(true);
      repo.lookupFactor = vi.fn().mockResolvedValue(makeEmailFactor());

      await expect(service.registerEmailFactor('user@invite-only.com', 'code')).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(repo.lookupFactor).not.toHaveBeenCalled();
    });

    it('throws 409 when lookupFactor returns an existing factor', async () => {
      repo.lookupFactor = vi.fn().mockResolvedValue(makeEmailFactor());
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

    it('deletes the cached registration entries after a successful registration', async () => {
      const payload = makeRegistrationPayload({ verificationMethod: 'code', value: 'user@example.com' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      vi.mocked(otpProvider.validate).mockReturnValue(true);
      repo.createFactor = vi.fn().mockResolvedValue(makeEmailFactor());

      await service.createEmailFactorFromRegistration('actor-1', 'reg-id-1', '123456');

      expect(cache.delete).toHaveBeenCalledWith('email_factor_registration_reg-id-1');
      expect(cache.delete).toHaveBeenCalledWith('email_factor_registration_user@example.com');
    });
  });

  describe('issueEmailChallenge', () => {
    it('throws 404 when the factor does not exist', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(null);
      await expect(service.issueEmailChallenge('actor-1', 'factor-1', 'code')).rejects.toMatchObject({
        statusCode: 404,
        details: { factorId: 'not found' },
      });
    });

    it('throws 404 when the factor is not active', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor({ active: false }));
      await expect(service.issueEmailChallenge('actor-1', 'factor-1', 'code')).rejects.toMatchObject({
        statusCode: 404,
        details: { factorId: 'not found' },
      });
    });

    it('returns email, challengeId, code, expiresAt, issuedAt, and alreadyIssued=false for a code-based challenge', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor());

      const result = await service.issueEmailChallenge('actor-1', 'factor-1', 'code');

      expect(result.email).toBe('user@example.com');
      expect(result.challengeId).toBeTruthy();
      expect(result.code).toBe('123456');
      expect(DateTime.isDateTime(result.expiresAt)).toBe(true);
      expect(DateTime.isDateTime(result.issuedAt)).toBe(true);
      expect(result.alreadyIssued).toBe(false);
    });

    it('caches the challenge payload under both the challenge id and actor+factor keys', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor());

      await service.issueEmailChallenge('actor-1', 'factor-1', 'code');

      // Two cache.set calls: one for the payload, one for the actor_factor → id lookup
      expect(cache.set).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = vi.mocked(cache.set).mock.calls;
      const [payloadKey, payloadJson] = firstCall!;
      expect(payloadKey).toMatch(/^email_factor_challenge_/);
      const payload = JSON.parse(payloadJson as string);
      expect(payload.actorId).toBe('actor-1');
      expect(payload.factorId).toBe('factor-1');
      expect(secondCall![0]).toBe('email_factor_challenge_actor-1_factor-1');
    });

    it('returns the existing pending challenge with alreadyIssued=true when one is cached', async () => {
      const payload = makeChallengePayload();
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor());
      cache.get = vi.fn().mockResolvedValueOnce('chal-id-1').mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.issueEmailChallenge('actor-1', 'factor-1', 'code');

      expect(result.email).toBe('user@example.com');
      expect(result.challengeId).toBe('chal-id-1');
      expect(result.code).toBe('123456');
      expect(result.alreadyIssued).toBe(true);
      expect(result.expiresAt.toUnixInteger()).toBe(payload.expiresAt);
      expect(result.issuedAt.toUnixInteger()).toBe(payload.issuedAt);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('uses magic link for magiclink challenge method', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor());

      await service.issueEmailChallenge('actor-1', 'factor-1', 'magiclink');

      const [firstCall] = vi.mocked(cache.set).mock.calls;
      const payload = JSON.parse(firstCall![1] as string);
      expect(payload.verificationMethod).toBe('magiclink');
    });
  });

  describe('verifyEmailChallenge', () => {
    it('throws 404 when the challenge does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.verifyEmailChallenge('missing-id', '123456')).rejects.toMatchObject({
        statusCode: 404,
        details: { challengeId: 'not found' },
      });
    });

    it('throws 401 when the factor has been deleted since the challenge was issued', async () => {
      const payload = makeChallengePayload({ verificationMethod: 'code' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(undefined);

      await expect(service.verifyEmailChallenge('chal-id-1', '123456')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when the factor has been deactivated since the challenge was issued', async () => {
      const payload = makeChallengePayload({ verificationMethod: 'code' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor({ active: false }));

      await expect(service.verifyEmailChallenge('chal-id-1', '123456')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 400 when the OTP code is invalid', async () => {
      const payload = makeChallengePayload({ verificationMethod: 'code' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor());
      vi.mocked(otpProvider.validate).mockReturnValue(false);

      await expect(service.verifyEmailChallenge('chal-id-1', 'wrong')).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'invalid code' },
      });
    });

    it('throws 400 when the magic link token does not match', async () => {
      const payload = makeChallengePayload({ verificationMethod: 'magiclink', code: 'correct-token' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor());

      await expect(service.verifyEmailChallenge('chal-id-1', 'wrong-token')).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'invalid magiclink' },
      });
    });

    it('returns the verified factor for a valid code challenge', async () => {
      const factor = makeEmailFactor();
      const payload = makeChallengePayload({ verificationMethod: 'code' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(factor);
      vi.mocked(otpProvider.validate).mockReturnValue(true);

      const result = await service.verifyEmailChallenge('chal-id-1', '123456');

      expect(result).toBe(factor);
    });

    it('returns the verified factor for a valid magic link', async () => {
      const factor = makeEmailFactor();
      const payload = makeChallengePayload({ verificationMethod: 'magiclink', code: 'the-magic-token' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(factor);

      const result = await service.verifyEmailChallenge('chal-id-1', 'the-magic-token');

      expect(result).toBe(factor);
    });

    it('deletes the cached challenge entries after a successful verification', async () => {
      const payload = makeChallengePayload({ verificationMethod: 'code' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.getFactor = vi.fn().mockResolvedValue(makeEmailFactor());
      vi.mocked(otpProvider.validate).mockReturnValue(true);

      await service.verifyEmailChallenge('chal-id-1', '123456');

      expect(cache.delete).toHaveBeenCalledWith('email_factor_challenge_chal-id-1');
      expect(cache.delete).toHaveBeenCalledWith('email_factor_challenge_actor-1_factor-1');
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
      expect(cache.get).toHaveBeenCalledWith('email_factor_challenge_chal-id-1');
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
      expect(cache.get).toHaveBeenCalledWith('email_factor_registration_reg-id-1');
    });
  });

  describe('getRedirectHtml', () => {
    it('returns html and a nonce for an https URL', () => {
      const result = service.getRedirectHtml(new URL('https://example.com/landing'));

      expect(result.nonce).toBeTruthy();
      expect(typeof result.nonce).toBe('string');
      expect(result.html).toContain('https://example.com/landing');
    });

    it('returns html and a nonce for an http URL', () => {
      const result = service.getRedirectHtml(new URL('http://example.com/landing'));

      expect(result.nonce).toBeTruthy();
      expect(result.html).toContain('http://example.com/landing');
    });

    it('embeds the generated nonce in the inline script tag', () => {
      const result = service.getRedirectHtml(new URL('https://example.com/'));

      expect(result.html).toContain(`nonce="${result.nonce}"`);
    });

    it('generates a fresh nonce on each call', () => {
      const a = service.getRedirectHtml(new URL('https://example.com/'));
      const b = service.getRedirectHtml(new URL('https://example.com/'));

      expect(a.nonce).not.toBe(b.nonce);
    });

    it('throws 400 with internal details when the URL is not http or https', () => {
      expect(() => service.getRedirectHtml(new URL('ftp://example.com/'))).toThrowError(
        expect.objectContaining({
          statusCode: 400,
          internalDetails: { redirectUrl: 'must be a valid http or https URL' },
        }),
      );
    });

    it('rejects javascript: URLs', () => {
      expect(() => service.getRedirectHtml(new URL('javascript:alert(1)'))).toThrowError(
        expect.objectContaining({ statusCode: 400 }),
      );
    });

    it('rejects file: URLs', () => {
      expect(() => service.getRedirectHtml(new URL('file:///etc/passwd'))).toThrowError(
        expect.objectContaining({ statusCode: 400 }),
      );
    });
  });
});
