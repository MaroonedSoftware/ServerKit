import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { CacheProvider } from '@maroonedsoftware/cache';
import { MfaChallengePayload, MfaEligibleFactor, TargetActor } from './types.js';
import { AuthenticationFactorKind, AuthenticationSessionFactor } from '../types.js';

/**
 * Configuration options for {@link MfaChallengeService}.
 */
@Injectable()
export class MfaChallengeServiceOptions {
  constructor(
    /** How long an issued challenge remains valid before it must be redeemed. */
    public readonly ttl: Duration = Duration.fromDurationLike({ minutes: 5 }),
  ) {}
}

interface SerializedFactor {
  method: AuthenticationSessionFactor['method'];
  methodId: string;
  kind: AuthenticationSessionFactor['kind'];
  issuedAt: number;
  authenticatedAt: number;
}

interface SerializedEligibleFactor {
  method: MfaEligibleFactor['method'];
  methodId: string;
  /** Optional on the wire so in-flight challenges issued before this field was added still deserialize. */
  kind?: AuthenticationFactorKind;
  label?: string;
}

interface MfaChallengePayloadShape {
  challengeId: string;
  actor: TargetActor;
  primaryFactor: SerializedFactor;
  eligibleFactors: SerializedEligibleFactor[];
  issuedAt: number;
  expiresAt: number;
}

/**
 * Default applied when deserializing an eligible factor whose `kind` was not
 * persisted. The default policy filters knowledge factors out of the eligible
 * list, so any in-flight challenge is overwhelmingly likely to be `possession`.
 */
const DEFAULT_ELIGIBLE_FACTOR_KIND: AuthenticationFactorKind = 'possession';

/**
 * Stash and redeem short-lived MFA challenges in cache.
 *
 * Issued after a primary factor succeeds but a {@link DefaultMfaRequiredPolicy}
 * (or a subclass) determines that a second factor is required. The challenge
 * carries the primary factor and the list of eligible secondary factors so the
 * orchestrator can pick up where it left off when the client comes back with a
 * proof.
 *
 * Redemption is single-use: {@link redeem} deletes the cache entry after
 * reading it, so a leaked challenge id can be used at most once.
 */
@Injectable()
export class MfaChallengeService {
  constructor(
    private readonly options: MfaChallengeServiceOptions,
    private readonly cache: CacheProvider,
  ) {}

  private getKey(challengeId: string) {
    return `mfa_challenge_${challengeId}`;
  }

  private serialize(payload: MfaChallengePayload): string {
    const shape: MfaChallengePayloadShape = {
      challengeId: payload.challengeId,
      actor: payload.actor,
      primaryFactor: {
        method: payload.primaryFactor.method,
        methodId: payload.primaryFactor.methodId,
        kind: payload.primaryFactor.kind,
        issuedAt: payload.primaryFactor.issuedAt.toUnixInteger(),
        authenticatedAt: payload.primaryFactor.authenticatedAt.toUnixInteger(),
      },
      eligibleFactors: payload.eligibleFactors.map(({ method, methodId, kind, label }) => ({
        method,
        methodId,
        kind,
        ...(label != null ? { label } : {}),
      })),
      issuedAt: payload.issuedAt.toUnixInteger(),
      expiresAt: payload.expiresAt.toUnixInteger(),
    };
    return JSON.stringify(shape);
  }

  private deserialize(data: string): MfaChallengePayload {
    const shape = JSON.parse(data) as MfaChallengePayloadShape;
    return {
      challengeId: shape.challengeId,
      actor: shape.actor,
      primaryFactor: {
        method: shape.primaryFactor.method,
        methodId: shape.primaryFactor.methodId,
        kind: shape.primaryFactor.kind,
        issuedAt: DateTime.fromSeconds(shape.primaryFactor.issuedAt),
        authenticatedAt: DateTime.fromSeconds(shape.primaryFactor.authenticatedAt),
      },
      eligibleFactors: shape.eligibleFactors.map(({ method, methodId, kind, label }) => ({
        method,
        methodId,
        kind: kind ?? DEFAULT_ELIGIBLE_FACTOR_KIND,
        ...(label != null ? { label } : {}),
      })),
      issuedAt: DateTime.fromSeconds(shape.issuedAt),
      expiresAt: DateTime.fromSeconds(shape.expiresAt),
    };
  }

  /**
   * Issue a new MFA challenge and store it in cache.
   *
   * @returns The issued {@link MfaChallengePayload} including the generated
   *   `challengeId` and timestamps. Single-use: pass `challengeId` to
   *   {@link redeem} to complete the flow.
   */
  async issue(input: Pick<MfaChallengePayload, 'actor' | 'primaryFactor' | 'eligibleFactors'>): Promise<MfaChallengePayload> {
    const challengeId = crypto.randomBytes(32).toString('base64url');
    const issuedAt = DateTime.utc();
    const expiresAt = issuedAt.plus(this.options.ttl);

    const payload: MfaChallengePayload = {
      challengeId,
      actor: input.actor,
      primaryFactor: input.primaryFactor,
      eligibleFactors: input.eligibleFactors,
      issuedAt,
      expiresAt,
    };

    await this.cache.set(this.getKey(challengeId), this.serialize(payload), this.options.ttl);

    return payload;
  }

  /**
   * Look up a challenge without consuming it. Returns `null` when the challenge
   * has expired or does not exist.
   */
  async peek(challengeId: string): Promise<MfaChallengePayload | null> {
    const data = await this.cache.get(this.getKey(challengeId));
    return data ? this.deserialize(data) : null;
  }

  /**
   * Look up a challenge and delete it in the same call. Returns `null` when the
   * challenge has expired or does not exist. Use this when completing MFA so
   * the challenge id cannot be replayed.
   */
  async redeem(challengeId: string): Promise<MfaChallengePayload | null> {
    const data = await this.cache.get(this.getKey(challengeId));
    if (!data) {
      return null;
    }
    await this.cache.delete(this.getKey(challengeId));
    return this.deserialize(data);
  }
}
