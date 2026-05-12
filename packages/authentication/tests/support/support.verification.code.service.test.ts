import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CacheProvider } from '@maroonedsoftware/cache';
import type { EncryptionProvider } from '@maroonedsoftware/encryption';
import type { Logger } from '@maroonedsoftware/logger';
import { PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import type { RateLimiterCompatibleAbstract } from 'rate-limiter-flexible';
import { OtpProvider, TotpOptions } from '../../src/providers/otp.provider.js';
import {
  SupportVerificationCodeService,
  SupportVerificationCodeServiceOptions,
} from '../../src/support/support.verification.code.service.js';
import type {
  SupportVerificationSecret,
  SupportVerificationSecretRepository,
} from '../../src/support/support.verification.secret.repository.js';

const actor = { kind: 'user', actorId: 'user-1' };

const makeRepository = () => {
  const store = new Map<string, SupportVerificationSecret>();
  return {
    store,
    getSecret: vi.fn(async (actorId: string) => store.get(actorId)),
    upsertSecret: vi.fn(async (actorId: string, value: { secretHash: string; options: TotpOptions }) => {
      const record: SupportVerificationSecret = {
        actorId,
        secretHash: value.secretHash,
        options: value.options,
        createdAt: Math.floor(Date.now() / 1000),
      };
      store.set(actorId, record);
      return record;
    }),
    deleteSecret: vi.fn(async (actorId: string) => {
      store.delete(actorId);
    }),
  } as unknown as SupportVerificationSecretRepository & { store: Map<string, SupportVerificationSecret> };
};

const makeCache = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    update: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had ? key : null;
    }),
  } as unknown as CacheProvider & { store: Map<string, string> };
};

const makeEncryption = () =>
  ({
    encrypt: vi.fn((plaintext: string) => `enc:${plaintext}`),
    decrypt: vi.fn((cipher: string) => cipher.replace(/^enc:/, '')),
  }) as unknown as EncryptionProvider;

const makeRateLimiter = () =>
  ({
    consume: vi.fn().mockResolvedValue(undefined),
    reward: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }) as unknown as RateLimiterCompatibleAbstract;

const makePolicyService = (result: PolicyResult = { allowed: true }) =>
  ({
    check: vi.fn(async () => result),
    assert: vi.fn(async () => undefined),
  }) as unknown as PolicyService;

const makeLogger = () =>
  ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }) as unknown as Logger;

describe('SupportVerificationCodeService', () => {
  let repo: ReturnType<typeof makeRepository>;
  let cache: ReturnType<typeof makeCache>;
  let encryption: ReturnType<typeof makeEncryption>;
  let rateLimiter: ReturnType<typeof makeRateLimiter>;
  let policyService: ReturnType<typeof makePolicyService>;
  let logger: ReturnType<typeof makeLogger>;
  let otpProvider: OtpProvider;
  let service: SupportVerificationCodeService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'));
    repo = makeRepository();
    cache = makeCache();
    encryption = makeEncryption();
    rateLimiter = makeRateLimiter();
    policyService = makePolicyService();
    logger = makeLogger();
    otpProvider = new OtpProvider();
    service = new SupportVerificationCodeService(
      new SupportVerificationCodeServiceOptions(),
      otpProvider,
      repo,
      encryption,
      cache,
      rateLimiter,
      policyService,
      logger,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('issueCode', () => {
    it('creates a secret lazily on first call and returns a 6-digit code', async () => {
      const result = await service.issueCode(actor);

      expect(repo.upsertSecret).toHaveBeenCalledOnce();
      expect(result.code).toMatch(/^\d{6}$/);
      expect(result.periodSeconds).toBe(30);
      expect(result.expiresAt.toMillis()).toBeGreaterThan(result.issuedAt.toMillis());
    });

    it('encrypts the generated secret before storing it', async () => {
      await service.issueCode(actor);
      expect(encryption.encrypt).toHaveBeenCalledOnce();
      const stored = repo.store.get(actor.actorId)!;
      expect(stored.secretHash.startsWith('enc:')).toBe(true);
    });

    it('reuses the existing secret on subsequent calls', async () => {
      await service.issueCode(actor);
      await service.issueCode(actor);
      expect(repo.upsertSecret).toHaveBeenCalledOnce();
    });

    it('returns the same code within a single period and a different code after rotation', async () => {
      const first = await service.issueCode(actor);
      vi.advanceTimersByTime(5_000);
      const sameWindow = await service.issueCode(actor);
      vi.advanceTimersByTime(30_000);
      const nextWindow = await service.issueCode(actor);

      expect(sameWindow.code).toBe(first.code);
      expect(nextWindow.code).not.toBe(first.code);
    });

    it('rejects with 403 when the policy denies', async () => {
      const denyingPolicy = makePolicyService({ allowed: false, reason: 'org_disabled' });
      service = new SupportVerificationCodeService(
        new SupportVerificationCodeServiceOptions(),
        otpProvider,
        repo,
        encryption,
        cache,
        rateLimiter,
        denyingPolicy,
        logger,
      );

      await expect(service.issueCode(actor)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('audit-logs issuance', async () => {
      await service.issueCode(actor);
      expect(logger.info).toHaveBeenCalledWith('support_verification.issued', expect.objectContaining({ actorId: actor.actorId }));
    });
  });

  describe('verifyCode', () => {
    it('accepts the current code', async () => {
      const { code } = await service.issueCode(actor);
      const result = await service.verifyCode(actor, code);

      expect(result.actorId).toBe(actor.actorId);
      expect(rateLimiter.consume).toHaveBeenCalledWith('support_verification:user-1');
      expect(rateLimiter.reward).toHaveBeenCalledWith('support_verification:user-1');
    });

    it('accepts a code from the previous period (drift window)', async () => {
      const { code } = await service.issueCode(actor);
      vi.advanceTimersByTime(30_000);
      await expect(service.verifyCode(actor, code)).resolves.toMatchObject({ actorId: actor.actorId });
    });

    it('rejects a code outside the drift window', async () => {
      const { code } = await service.issueCode(actor);
      vi.advanceTimersByTime(120_000);
      await expect(service.verifyCode(actor, code)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('rejects a replayed code within the drift window', async () => {
      const { code } = await service.issueCode(actor);
      await service.verifyCode(actor, code);
      await expect(service.verifyCode(actor, code)).rejects.toMatchObject({ statusCode: 401 });
      expect(logger.warn).toHaveBeenCalledWith('support_verification.replay', expect.any(Object));
    });

    it('rejects an invalid code with 401', async () => {
      await service.issueCode(actor);
      await expect(service.verifyCode(actor, '000000')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 404 when the actor has never issued a code', async () => {
      await expect(service.verifyCode(actor, '123456')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 429 when rate-limited', async () => {
      await service.issueCode(actor);
      (rateLimiter.consume as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('rate-limited'));
      await expect(service.verifyCode(actor, '123456')).rejects.toMatchObject({ statusCode: 429 });
    });

    it('rejects with 403 when the policy denies before any other check', async () => {
      const denyingPolicy = makePolicyService({ allowed: false, reason: 'org_disabled' });
      service = new SupportVerificationCodeService(
        new SupportVerificationCodeServiceOptions(),
        otpProvider,
        repo,
        encryption,
        cache,
        rateLimiter,
        denyingPolicy,
        logger,
      );
      await expect(service.verifyCode(actor, '123456')).rejects.toMatchObject({ statusCode: 403 });
      expect(rateLimiter.consume).not.toHaveBeenCalled();
    });

    it('rate-limit and replay keys are scoped per actor', async () => {
      const a = { kind: 'user', actorId: 'actor-a' };
      const b = { kind: 'user', actorId: 'actor-b' };
      const { code: codeA } = await service.issueCode(a);
      const { code: codeB } = await service.issueCode(b);

      await service.verifyCode(a, codeA);
      await expect(service.verifyCode(b, codeB)).resolves.toMatchObject({ actorId: 'actor-b' });
    });

    it('audit-logs success and failure', async () => {
      const { code } = await service.issueCode(actor);
      await service.verifyCode(actor, code);
      expect(logger.info).toHaveBeenCalledWith('support_verification.succeeded', expect.objectContaining({ actorId: actor.actorId }));

      await expect(service.verifyCode(actor, '000000')).rejects.toMatchObject({ statusCode: 401 });
      expect(logger.warn).toHaveBeenCalledWith('support_verification.failed', expect.objectContaining({ actorId: actor.actorId }));
    });
  });

  describe('rotateSecret', () => {
    it('replaces the prior secret so old codes stop validating', async () => {
      const { code: oldCode } = await service.issueCode(actor);
      await service.rotateSecret(actor.actorId);

      await expect(service.verifyCode(actor, oldCode)).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe('revoke', () => {
    it('deletes the secret so subsequent verify calls 404', async () => {
      const { code } = await service.issueCode(actor);
      await service.revoke(actor.actorId);

      await expect(service.verifyCode(actor, code)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('hasSecret', () => {
    it('reports false before issuance and true after', async () => {
      expect(await service.hasSecret(actor.actorId)).toBe(false);
      await service.issueCode(actor);
      expect(await service.hasSecret(actor.actorId)).toBe(true);
    });
  });

  describe('clearRateLimit', () => {
    it('clears the limiter for the actor', async () => {
      await service.clearRateLimit(actor.actorId);
      expect(rateLimiter.delete).toHaveBeenCalledWith('support_verification:user-1');
    });
  });
});
