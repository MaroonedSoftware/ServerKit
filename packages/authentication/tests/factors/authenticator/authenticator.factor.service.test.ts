import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('qrcode', () => ({
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,MOCKQR'),
}));

import { toDataURL } from 'qrcode';
import { AuthenticatorFactorService } from '../../../src/factors/authenticator/authenticator.factor.service.js';
import type { AuthenticatorFactorRepository, AuthenticatorFactor } from '../../../src/factors/authenticator/authenticator.factor.repository.js';
import type { OtpProvider } from '../../../src/providers/otp.provider.js';
import type { CacheProvider } from '../../../src/providers/cache.provider.js';
import type { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Duration } from 'luxon';

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
    generateURI: vi.fn().mockReturnValue('otpauth://totp/Example:actor-1?secret=TESTSECRET'),
  }) as unknown as OtpProvider;

const makeEncryptionProvider = () =>
  ({
    encrypt: vi.fn().mockReturnValue('encrypted-secret'),
    decrypt: vi.fn().mockReturnValue('TESTSECRET'),
  }) as unknown as EncryptionProvider;

const makeRepository = () =>
  ({
    createFactor: vi.fn(),
    getFactor: vi.fn(),
    deleteFactor: vi.fn(),
  }) as unknown as AuthenticatorFactorRepository;

const makeAuthenticatorFactor = (overrides: Partial<AuthenticatorFactor> = {}): AuthenticatorFactor => ({
  id: 'factor-1',
  active: true,
  secretHash: 'encrypted-secret',
  type: 'totp',
  algorithm: 'SHA1',
  counter: 0,
  periodSeconds: 30,
  tokenLength: 6,
  ...overrides,
});

const makeOptions = () => ({
  issuer: 'TestApp',
  registrationExpiration: Duration.fromObject({ minutes: 30 }),
  factorExpiration: Duration.fromObject({ hours: 4 }),
});

const makeRegistrationPayload = (overrides = {}) => ({
  id: 'reg-id-1',
  actorId: 'actor-1',
  secretHash: 'encrypted-secret',
  expiresAt: Math.floor(Date.now() / 1000) + 1800,
  issuedAt: Math.floor(Date.now() / 1000),
  otpOptions: { type: 'totp' as const, algorithm: 'SHA1', counter: 0, periodSeconds: 30, tokenLength: 6 },
  ...overrides,
});

describe('AuthenticatorFactorService', () => {
  let cache: ReturnType<typeof makeCacheProvider>;
  let otpProvider: ReturnType<typeof makeOtpProvider>;
  let encryptionProvider: ReturnType<typeof makeEncryptionProvider>;
  let repo: ReturnType<typeof makeRepository>;
  let service: AuthenticatorFactorService;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCacheProvider();
    otpProvider = makeOtpProvider();
    encryptionProvider = makeEncryptionProvider();
    repo = makeRepository();
    service = new AuthenticatorFactorService(makeOptions(), otpProvider, repo, encryptionProvider, cache);
  });

  describe('registerAuthenticatorFactor', () => {
    it('generates a secret via otpProvider.createSecret', async () => {
      await service.registerAuthenticatorFactor('actor-1');
      expect(otpProvider.createSecret).toHaveBeenCalledOnce();
    });

    it('encrypts the secret and stores the hash', async () => {
      await service.registerAuthenticatorFactor('actor-1');
      expect(encryptionProvider.encrypt).toHaveBeenCalledWith('TESTSECRET');
    });

    it('generates a provisioning URI with the configured issuer', async () => {
      await service.registerAuthenticatorFactor('actor-1');
      expect(otpProvider.generateURI).toHaveBeenCalledWith('TESTSECRET', expect.any(Object), { issuer: 'TestApp' });
    });

    it('generates a QR code data URL from the provisioning URI', async () => {
      await service.registerAuthenticatorFactor('actor-1');
      expect(toDataURL).toHaveBeenCalledWith('otpauth://totp/Example:actor-1?secret=TESTSECRET');
    });

    it('caches the registration payload', async () => {
      await service.registerAuthenticatorFactor('actor-1');
      expect(cache.set).toHaveBeenCalledOnce();
      const [[key, payloadJson]] = vi.mocked(cache.set).mock.calls;
      expect(key).toMatch(/^authenticator_factor_registration_/);
      const payload = JSON.parse(payloadJson as string);
      expect(payload.actorId).toBe('actor-1');
      expect(payload.secretHash).toBe('encrypted-secret');
    });

    it('returns registrationId, secret, uri, qrCode, and expiresAt', async () => {
      const result = await service.registerAuthenticatorFactor('actor-1');
      expect(result.registrationId).toBeTruthy();
      expect(result.secret).toBe('TESTSECRET');
      expect(result.uri).toBe('otpauth://totp/Example:actor-1?secret=TESTSECRET');
      expect(result.qrCode).toBe('data:image/png;base64,MOCKQR');
      expect(result.expiresAt).toBeDefined();
    });

    it('applies custom OTP options over defaults', async () => {
      await service.registerAuthenticatorFactor('actor-1', { type: 'totp', algorithm: 'SHA256', periodSeconds: 60, tokenLength: 8, counter: 0 });
      expect(otpProvider.generateURI).toHaveBeenCalledWith(
        'TESTSECRET',
        expect.objectContaining({ algorithm: 'SHA256', periodSeconds: 60, tokenLength: 8 }),
        { issuer: 'TestApp' },
      );
    });
  });

  describe('createAuthenticatorFactorFromRegistration', () => {
    it('throws 404 when the registration does not exist', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      await expect(service.createAuthenticatorFactorFromRegistration('actor-1', 'missing-reg', '123456')).rejects.toMatchObject({
        statusCode: 404,
        details: { registrationId: 'not found' },
      });
    });

    it('throws 400 when the actorId does not match the registration', async () => {
      const payload = makeRegistrationPayload({ actorId: 'actor-1' });
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      await expect(service.createAuthenticatorFactorFromRegistration('actor-2', 'reg-id-1', '123456')).rejects.toMatchObject({
        statusCode: 400,
        details: { actorId: 'invalid actor' },
      });
    });

    it('throws 401 when the OTP code is invalid', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      vi.mocked(otpProvider.validate).mockReturnValue(false);
      await expect(service.createAuthenticatorFactorFromRegistration('actor-1', 'reg-id-1', 'wrong')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('decrypts the secret before validating the code', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makeAuthenticatorFactor());
      await service.createAuthenticatorFactorFromRegistration('actor-1', 'reg-id-1', '123456');
      expect(encryptionProvider.decrypt).toHaveBeenCalledWith('encrypted-secret');
    });

    it('validates the code against the decrypted secret', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makeAuthenticatorFactor());
      await service.createAuthenticatorFactorFromRegistration('actor-1', 'reg-id-1', '123456');
      expect(otpProvider.validate).toHaveBeenCalledWith('123456', 'TESTSECRET', payload.otpOptions);
    });

    it('persists the factor with the encrypted secret hash', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makeAuthenticatorFactor());
      await service.createAuthenticatorFactorFromRegistration('actor-1', 'reg-id-1', '123456');
      expect(repo.createFactor).toHaveBeenCalledWith('actor-1', expect.objectContaining({ secretHash: 'encrypted-secret' }));
    });

    it('returns the new factor id on success', async () => {
      const payload = makeRegistrationPayload();
      cache.get = vi.fn().mockResolvedValue(JSON.stringify(payload));
      repo.createFactor = vi.fn().mockResolvedValue(makeAuthenticatorFactor({ id: 'new-factor-id' }));
      const result = await service.createAuthenticatorFactorFromRegistration('actor-1', 'reg-id-1', '123456');
      expect(result).toBe('new-factor-id');
    });
  });

  describe('validateFactor', () => {
    it('throws 401 when the factor does not exist', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(undefined);
      await expect(service.validateFactor('actor-1', 'factor-1', '123456')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when the factor is not active', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeAuthenticatorFactor({ active: false }));
      await expect(service.validateFactor('actor-1', 'factor-1', '123456')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 when the OTP code is invalid', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeAuthenticatorFactor());
      vi.mocked(otpProvider.validate).mockReturnValue(false);
      await expect(service.validateFactor('actor-1', 'factor-1', 'wrong')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('decrypts the secret hash before validating', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeAuthenticatorFactor());
      await service.validateFactor('actor-1', 'factor-1', '123456');
      expect(encryptionProvider.decrypt).toHaveBeenCalledWith('encrypted-secret');
    });

    it('validates the code against the decrypted secret and factor options', async () => {
      const factor = makeAuthenticatorFactor();
      repo.getFactor = vi.fn().mockResolvedValue(factor);
      await service.validateFactor('actor-1', 'factor-1', '123456');
      expect(otpProvider.validate).toHaveBeenCalledWith('123456', 'TESTSECRET', factor);
    });

    it('resolves without throwing for a valid code', async () => {
      repo.getFactor = vi.fn().mockResolvedValue(makeAuthenticatorFactor());
      await expect(service.validateFactor('actor-1', 'factor-1', '123456')).resolves.toBeUndefined();
    });
  });

  describe('deleteFactor', () => {
    it('delegates deletion to the repository', async () => {
      repo.deleteFactor = vi.fn().mockResolvedValue(undefined);
      await service.deleteFactor('actor-1', 'factor-1');
      expect(repo.deleteFactor).toHaveBeenCalledWith('actor-1', 'factor-1');
    });

    it('resolves without throwing', async () => {
      repo.deleteFactor = vi.fn().mockResolvedValue(undefined);
      await expect(service.deleteFactor('actor-1', 'factor-1')).resolves.toBeUndefined();
    });
  });
});
