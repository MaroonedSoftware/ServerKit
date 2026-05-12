import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { RecoveryChallengeService, RecoveryChallengeServiceOptions } from '../../src/recovery/recovery.challenge.service.js';
import { RecoveryEligibleChannel } from '../../src/recovery/types.js';

const makeCache = () => {
  const store = new Map<string, string>();
  return {
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
  } as unknown as CacheProvider;
};

const actor = { kind: 'user', actorId: 'user-1' };
const channels: RecoveryEligibleChannel[] = [{ channel: 'email', methodId: 'email-1' }];

describe('RecoveryChallengeService', () => {
  let cache: ReturnType<typeof makeCache>;
  let service: RecoveryChallengeService;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCache();
    service = new RecoveryChallengeService(new RecoveryChallengeServiceOptions(), cache);
  });

  it('issues a challenge with a token, timestamps, and the supplied inputs', async () => {
    const payload = await service.issue({ actor, reason: 'password_reset', eligibleChannels: channels });

    expect(payload.challengeId).toBeTruthy();
    expect(payload.actor).toEqual(actor);
    expect(payload.reason).toBe('password_reset');
    expect(payload.eligibleChannels).toEqual(channels);
    expect(payload.issuedAt).toBeInstanceOf(DateTime);
    expect(payload.expiresAt).toBeInstanceOf(DateTime);
  });

  it('peek returns the stored payload without consuming it', async () => {
    const issued = await service.issue({ actor, reason: 'password_reset', eligibleChannels: channels });
    const first = await service.peek(issued.challengeId);
    const second = await service.peek(issued.challengeId);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
  });

  it('redeem returns the payload and deletes it from cache', async () => {
    const issued = await service.issue({ actor, reason: 'password_reset', eligibleChannels: channels });

    const redeemed = await service.redeem(issued.challengeId);
    expect(redeemed?.challengeId).toBe(issued.challengeId);

    expect(await service.peek(issued.challengeId)).toBeNull();
    expect(await service.redeem(issued.challengeId)).toBeNull();
  });

  it('peek returns null for an unknown challenge id', async () => {
    expect(await service.peek('does-not-exist')).toBeNull();
  });

  it('attachChannelSelection updates the cached payload', async () => {
    const issued = await service.issue({ actor, reason: 'password_reset', eligibleChannels: channels });

    const updated = await service.attachChannelSelection(issued.challengeId, {
      selectedChannel: 'email',
      channelChallengeId: 'email-chal-1',
    });

    expect(updated?.selectedChannel).toBe('email');
    expect(updated?.channelChallengeId).toBe('email-chal-1');

    const peeked = await service.peek(issued.challengeId);
    expect(peeked?.selectedChannel).toBe('email');
    expect(peeked?.channelChallengeId).toBe('email-chal-1');
  });

  it('attachChannelSelection returns null when the challenge does not exist', async () => {
    const result = await service.attachChannelSelection('does-not-exist', { selectedChannel: 'email' });
    expect(result).toBeNull();
  });

  it('serializes and deserializes payloads with anonymous (unknown actor) challenges', async () => {
    const payload = await service.issue({ actor: undefined, reason: 'password_reset', eligibleChannels: [] });
    const peeked = await service.peek(payload.challengeId);
    expect(peeked?.actor).toBeUndefined();
    expect(peeked?.eligibleChannels).toEqual([]);
  });
});
