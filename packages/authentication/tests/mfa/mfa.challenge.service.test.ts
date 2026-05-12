import { describe, it, expect, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { CacheProvider } from '@maroonedsoftware/cache';
import { MfaChallengeService, MfaChallengeServiceOptions } from '../../src/mfa/mfa.challenge.service.js';
import { AuthenticationSessionFactor } from '../../src/types.js';

const makeCache = () => {
  const store = new Map<string, string>();
  return {
    cache: {
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
    } as unknown as CacheProvider,
    store,
  };
};

const primaryFactor: AuthenticationSessionFactor = {
  method: 'password',
  methodId: 'pw-1',
  kind: 'knowledge',
  issuedAt: DateTime.fromISO('2026-01-15T10:00:00Z', { zone: 'utc' }),
  authenticatedAt: DateTime.fromISO('2026-01-15T10:00:30Z', { zone: 'utc' }),
};

const eligibleFactors = [{ method: 'phone' as const, methodId: 'phone-1' }];

const actor = { kind: 'user', actorId: 'user-42' };

describe('MfaChallengeService', () => {
  it('issues a challenge with a generated id, timestamps, and default 5-minute TTL', async () => {
    const { cache } = makeCache();
    const service = new MfaChallengeService(new MfaChallengeServiceOptions(), cache);
    const before = DateTime.utc();

    const payload = await service.issue({ actor, primaryFactor, eligibleFactors });

    expect(payload.challengeId).toBeTruthy();
    expect(payload.actor).toEqual(actor);
    expect(payload.eligibleFactors).toEqual(eligibleFactors);
    expect(payload.expiresAt.diff(payload.issuedAt).as('minutes')).toBeCloseTo(5, 5);
    expect(payload.issuedAt >= before).toBe(true);

    expect(cache.set).toHaveBeenCalledOnce();
    const [key, _value, ttl] = (cache.set as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toBe(`mfa_challenge_${payload.challengeId}`);
    expect((ttl as Duration).as('minutes')).toBeCloseTo(5, 5);
  });

  it('honors a custom TTL', async () => {
    const { cache } = makeCache();
    const service = new MfaChallengeService(new MfaChallengeServiceOptions(Duration.fromObject({ minutes: 30 })), cache);

    const payload = await service.issue({ actor, primaryFactor, eligibleFactors });

    expect(payload.expiresAt.diff(payload.issuedAt).as('minutes')).toBeCloseTo(30, 5);
  });

  it('peek returns a deep-equal payload and does not delete the entry', async () => {
    const { cache } = makeCache();
    const service = new MfaChallengeService(new MfaChallengeServiceOptions(), cache);

    const issued = await service.issue({ actor, primaryFactor, eligibleFactors });
    const peeked = await service.peek(issued.challengeId);

    expect(peeked).not.toBeNull();
    expect(peeked!.challengeId).toBe(issued.challengeId);
    expect(peeked!.actor).toEqual(issued.actor);
    expect(peeked!.eligibleFactors).toEqual(issued.eligibleFactors);
    expect(peeked!.primaryFactor.method).toBe(primaryFactor.method);
    expect(peeked!.primaryFactor.methodId).toBe(primaryFactor.methodId);
    expect(peeked!.primaryFactor.kind).toBe(primaryFactor.kind);
    expect(peeked!.primaryFactor.issuedAt.toUnixInteger()).toBe(primaryFactor.issuedAt.toUnixInteger());
    expect(peeked!.primaryFactor.authenticatedAt.toUnixInteger()).toBe(primaryFactor.authenticatedAt.toUnixInteger());
    expect(peeked!.issuedAt.toUnixInteger()).toBe(issued.issuedAt.toUnixInteger());
    expect(peeked!.expiresAt.toUnixInteger()).toBe(issued.expiresAt.toUnixInteger());

    expect(cache.delete).not.toHaveBeenCalled();

    const peekedAgain = await service.peek(issued.challengeId);
    expect(peekedAgain).not.toBeNull();
  });

  it('redeem returns the payload and deletes the cache entry (single-use)', async () => {
    const { cache } = makeCache();
    const service = new MfaChallengeService(new MfaChallengeServiceOptions(), cache);

    const issued = await service.issue({ actor, primaryFactor, eligibleFactors });

    const redeemed = await service.redeem(issued.challengeId);
    expect(redeemed).not.toBeNull();
    expect(redeemed!.challengeId).toBe(issued.challengeId);

    expect(cache.delete).toHaveBeenCalledWith(`mfa_challenge_${issued.challengeId}`);

    const second = await service.redeem(issued.challengeId);
    expect(second).toBeNull();
  });

  it('peek and redeem return null for an unknown challenge id', async () => {
    const { cache } = makeCache();
    const service = new MfaChallengeService(new MfaChallengeServiceOptions(), cache);

    expect(await service.peek('does-not-exist')).toBeNull();
    expect(await service.redeem('does-not-exist')).toBeNull();
  });

  it('round-trips primary factor timestamps through JSON', async () => {
    const { cache } = makeCache();
    const service = new MfaChallengeService(new MfaChallengeServiceOptions(), cache);

    const issuedAt = DateTime.fromISO('2026-02-10T08:15:42Z', { zone: 'utc' });
    const factor: AuthenticationSessionFactor = {
      method: 'fido',
      methodId: 'fido-99',
      kind: 'possession',
      issuedAt,
      authenticatedAt: issuedAt.plus({ seconds: 17 }),
    };

    const issued = await service.issue({ actor, primaryFactor: factor, eligibleFactors });
    const peeked = (await service.peek(issued.challengeId))!;

    expect(peeked.primaryFactor.issuedAt.toUnixInteger()).toBe(issuedAt.toUnixInteger());
    expect(peeked.primaryFactor.authenticatedAt.toUnixInteger()).toBe(factor.authenticatedAt.toUnixInteger());
  });
});
