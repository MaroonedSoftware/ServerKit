import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RateLimiterCompatibleAbstract } from 'rate-limiter-flexible';
import { RecoveryFactorService, RecoveryFactorServiceOptions } from '../../../src/factors/recovery/recovery.factor.service.js';
import type { RecoveryCodeFactor, RecoveryCodeFactorRepository, RecoveryCodeValue } from '../../../src/factors/recovery/recovery.factor.repository.js';
import type { PasswordHashProvider } from '../../../src/providers/password.hash.provider.js';

const hashCode = (code: string, salt?: Buffer): RecoveryCodeValue => {
  salt ??= crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(code, salt, 1000, 32, 'sha256');
  return { hash: hash.toString('base64'), salt: salt.toString('base64') };
};

const makeRepository = () => {
  const factorsByActor = new Map<string, RecoveryCodeFactor[]>();
  return {
    factorsByActor,
    createFactor: vi.fn(),
    listFactors: vi.fn(async (actorId: string, active?: boolean) => {
      const all = factorsByActor.get(actorId) ?? [];
      return active === undefined ? all : all.filter(f => f.active === active);
    }),
    lookupFactor: vi.fn(),
    getFactor: vi.fn(),
    deleteFactor: vi.fn(),
    markUsed: vi.fn(async (actorId: string, factorId: string) => {
      const list = factorsByActor.get(actorId) ?? [];
      const f = list.find(x => x.id === factorId);
      if (!f) throw new Error('not found');
      f.active = false;
      f.usedAt = Math.floor(Date.now() / 1000);
      return f;
    }),
    replaceAll: vi.fn(async (actorId: string, values: ReadonlyArray<{ value: RecoveryCodeValue; batchId: string }>) => {
      const created: RecoveryCodeFactor[] = values.map((v, i) => ({
        id: `${actorId}-code-${i}`,
        actorId,
        active: true,
        value: v.value,
        batchId: v.batchId,
      }));
      factorsByActor.set(actorId, created);
      return created;
    }),
    countActive: vi.fn(async (actorId: string) => {
      const all = factorsByActor.get(actorId) ?? [];
      return all.filter(f => f.active).length;
    }),
  } as unknown as RecoveryCodeFactorRepository & { factorsByActor: Map<string, RecoveryCodeFactor[]> };
};

const makeHashProvider = () =>
  ({
    hash: vi.fn(async (code: string) => hashCode(code)),
    verify: vi.fn(async (code: string, hash: string, salt: string) => {
      const computed = crypto.pbkdf2Sync(code, Buffer.from(salt, 'base64'), 1000, 32, 'sha256').toString('base64');
      return computed === hash;
    }),
  }) as unknown as PasswordHashProvider;

const makeRateLimiter = () =>
  ({
    consume: vi.fn().mockResolvedValue(undefined),
    reward: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }) as unknown as RateLimiterCompatibleAbstract;

describe('RecoveryFactorService', () => {
  let repo: ReturnType<typeof makeRepository>;
  let hashProvider: ReturnType<typeof makeHashProvider>;
  let rateLimiter: ReturnType<typeof makeRateLimiter>;
  let service: RecoveryFactorService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepository();
    hashProvider = makeHashProvider();
    rateLimiter = makeRateLimiter();
    service = new RecoveryFactorService(new RecoveryFactorServiceOptions(), repo, hashProvider, rateLimiter);
  });

  describe('generateRecoveryCodes', () => {
    it('issues the configured number of codes and returns plaintext exactly once', async () => {
      const { codes, batchId, generatedAt } = await service.generateRecoveryCodes('actor-1');

      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      expect(codes.every(c => /^[0-9A-HJKMNP-TV-Z-]+$/.test(c) && c.replace(/-/g, '').length === 16)).toBe(true);
      expect(batchId).toBeTruthy();
      expect(generatedAt.isValid).toBe(true);
      expect(repo.replaceAll).toHaveBeenCalledWith('actor-1', expect.arrayContaining([expect.objectContaining({ batchId })]));
    });

    it('persists hashed codes — the stored values are not the plaintext', async () => {
      const { codes } = await service.generateRecoveryCodes('actor-1');
      const stored = repo.factorsByActor.get('actor-1')!;
      for (const code of codes) {
        expect(stored.some(f => f.value.hash === code)).toBe(false);
      }
    });

    it('replaces any prior batch on regenerate', async () => {
      const first = await service.generateRecoveryCodes('actor-1');
      const firstStored = [...repo.factorsByActor.get('actor-1')!];

      const second = await service.regenerateRecoveryCodes('actor-1');
      const secondStored = repo.factorsByActor.get('actor-1')!;

      expect(second.batchId).not.toBe(first.batchId);
      expect(secondStored.every(f => f.batchId === second.batchId)).toBe(true);
      expect(secondStored).not.toEqual(firstStored);
    });
  });

  describe('verifyRecoveryCode', () => {
    it('consumes a matching code single-use and returns the marked factor', async () => {
      const { codes } = await service.generateRecoveryCodes('actor-1');

      const consumed = await service.verifyRecoveryCode('actor-1', codes[0]!);

      expect(consumed.active).toBe(false);
      expect(consumed.usedAt).toBeTruthy();
      expect(repo.markUsed).toHaveBeenCalledWith('actor-1', consumed.id);
      expect(rateLimiter.reward).toHaveBeenCalled();
    });

    it('rejects the same code on a second attempt — codes are single-use', async () => {
      const { codes } = await service.generateRecoveryCodes('actor-1');
      await service.verifyRecoveryCode('actor-1', codes[0]!);

      await expect(service.verifyRecoveryCode('actor-1', codes[0]!)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('accepts a code regardless of dash placement and casing', async () => {
      const { codes } = await service.generateRecoveryCodes('actor-1');
      const munged = codes[0]!.replace(/-/g, '').toLowerCase();

      await expect(service.verifyRecoveryCode('actor-1', munged)).resolves.toMatchObject({ active: false });
    });

    it('throws 401 when no active code matches', async () => {
      await service.generateRecoveryCodes('actor-1');
      await expect(service.verifyRecoveryCode('actor-1', 'AAAAA-BBBBB-CCCCC')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 429 when rate-limited', async () => {
      (rateLimiter.consume as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('rate-limited'));
      await expect(service.verifyRecoveryCode('actor-1', 'AAAAA-BBBBB-CCCCC')).rejects.toMatchObject({ statusCode: 429 });
    });

    it('rate-limit key is scoped per actor', async () => {
      (rateLimiter.consume as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
      await service.generateRecoveryCodes('actor-1');
      const { codes } = await service.generateRecoveryCodes('actor-2');
      await service.verifyRecoveryCode('actor-2', codes[0]!);

      expect(rateLimiter.consume).toHaveBeenLastCalledWith('recovery:actor-2');
    });
  });

  describe('countRemainingCodes', () => {
    it('returns the number of active (unused) codes', async () => {
      const { codes } = await service.generateRecoveryCodes('actor-1');
      expect(await service.countRemainingCodes('actor-1')).toBe(10);

      await service.verifyRecoveryCode('actor-1', codes[0]!);
      expect(await service.countRemainingCodes('actor-1')).toBe(9);
    });
  });
});
