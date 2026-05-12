import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { CacheProvider } from '@maroonedsoftware/cache';
import { TargetActor } from '../mfa/types.js';
import { RecoveryChallengePayload, RecoveryChannel, RecoveryEligibleChannel, RecoveryReason } from './types.js';

/**
 * Configuration options for {@link RecoveryChallengeService}.
 */
@Injectable()
export class RecoveryChallengeServiceOptions {
  constructor(
    /** How long an issued recovery challenge remains valid before it must be redeemed. */
    public readonly ttl: Duration = Duration.fromDurationLike({ minutes: 10 }),
  ) {}
}

interface RecoveryChallengePayloadShape {
  challengeId: string;
  actor?: TargetActor;
  reason: RecoveryReason;
  eligibleChannels: RecoveryEligibleChannel[];
  selectedChannel?: RecoveryChannel;
  channelChallengeId?: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Stash and redeem short-lived recovery challenges in cache.
 *
 * The challenge is the connecting state across the three orchestrator
 * transitions ({@link RecoveryOrchestrator.initiateRecovery},
 * {@link RecoveryOrchestrator.issueChannelChallenge}, and
 * {@link RecoveryOrchestrator.verifyChannel}). Redemption is single-use:
 * {@link redeem} deletes the cache entry on read so a leaked challenge id can
 * be used at most once.
 */
@Injectable()
export class RecoveryChallengeService {
  constructor(
    private readonly options: RecoveryChallengeServiceOptions,
    private readonly cache: CacheProvider,
  ) {}

  private getKey(challengeId: string) {
    return `recovery_challenge_${challengeId}`;
  }

  private serialize(payload: RecoveryChallengePayload): string {
    const shape: RecoveryChallengePayloadShape = {
      challengeId: payload.challengeId,
      actor: payload.actor,
      reason: payload.reason,
      eligibleChannels: payload.eligibleChannels,
      selectedChannel: payload.selectedChannel,
      channelChallengeId: payload.channelChallengeId,
      issuedAt: payload.issuedAt.toUnixInteger(),
      expiresAt: payload.expiresAt.toUnixInteger(),
    };
    return JSON.stringify(shape);
  }

  private deserialize(data: string): RecoveryChallengePayload {
    const shape = JSON.parse(data) as RecoveryChallengePayloadShape;
    return {
      challengeId: shape.challengeId,
      actor: shape.actor,
      reason: shape.reason,
      eligibleChannels: shape.eligibleChannels,
      selectedChannel: shape.selectedChannel,
      channelChallengeId: shape.channelChallengeId,
      issuedAt: DateTime.fromSeconds(shape.issuedAt),
      expiresAt: DateTime.fromSeconds(shape.expiresAt),
    };
  }

  /**
   * Issue a new recovery challenge and store it in cache.
   *
   * @returns The issued payload, including the generated `challengeId`.
   */
  async issue(input: Pick<RecoveryChallengePayload, 'actor' | 'reason' | 'eligibleChannels'>): Promise<RecoveryChallengePayload> {
    const challengeId = crypto.randomBytes(32).toString('base64url');
    const issuedAt = DateTime.utc();
    const expiresAt = issuedAt.plus(this.options.ttl);

    const payload: RecoveryChallengePayload = {
      challengeId,
      actor: input.actor,
      reason: input.reason,
      eligibleChannels: input.eligibleChannels,
      issuedAt,
      expiresAt,
    };

    await this.cache.set(this.getKey(challengeId), this.serialize(payload), this.options.ttl);

    return payload;
  }

  /**
   * Update the cached challenge with the actor's selected channel and the
   * id of the per-factor sub-challenge issued for it. Refreshes the TTL.
   */
  async attachChannelSelection(
    challengeId: string,
    selection: { selectedChannel: RecoveryChannel; channelChallengeId?: string },
  ): Promise<RecoveryChallengePayload | null> {
    const existing = await this.peek(challengeId);
    if (!existing) return null;

    const updated: RecoveryChallengePayload = {
      ...existing,
      selectedChannel: selection.selectedChannel,
      channelChallengeId: selection.channelChallengeId,
    };
    await this.cache.set(this.getKey(challengeId), this.serialize(updated), this.options.ttl);
    return updated;
  }

  /**
   * Look up a challenge without consuming it. Returns `null` when the challenge
   * has expired or does not exist.
   */
  async peek(challengeId: string): Promise<RecoveryChallengePayload | null> {
    const data = await this.cache.get(this.getKey(challengeId));
    return data ? this.deserialize(data) : null;
  }

  /**
   * Look up a challenge and delete it in the same call. Returns `null` when the
   * challenge has expired or does not exist.
   */
  async redeem(challengeId: string): Promise<RecoveryChallengePayload | null> {
    const data = await this.cache.get(this.getKey(challengeId));
    if (!data) {
      return null;
    }
    await this.cache.delete(this.getKey(challengeId));
    return this.deserialize(data);
  }
}
