import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { CacheProvider } from '@maroonedsoftware/cache';
import { TargetActor } from '../mfa/types.js';
import { RecoveryActionKind, RecoveryChannel, RecoveryReason, RecoverySessionPayload } from './types.js';

/**
 * Configuration options for {@link RecoverySessionService}.
 */
@Injectable()
export class RecoverySessionServiceOptions {
  constructor(
    /** How long an issued recovery session remains redeemable. */
    public readonly ttl: Duration = Duration.fromDurationLike({ minutes: 10 }),
  ) {}
}

interface RecoverySessionPayloadShape {
  recoverySessionToken: string;
  actor: TargetActor;
  reason: RecoveryReason;
  verifiedVia: { channel: RecoveryChannel; methodId?: string };
  grantedActions: RecoveryActionKind[];
  issuedAt: number;
  expiresAt: number;
}

/**
 * Short-lived, single-use session minted after a recovery channel is verified.
 *
 * Crucially, this is **not** an {@link AuthenticationSession}:
 *
 * - The cache key prefix (`recovery_session_*`) is distinct, so
 *   {@link AuthenticationSessionService.getSession} cannot resolve a recovery
 *   session token.
 * - There is no JWT issuance method on this service — recovery tokens are
 *   opaque random strings that flow only to {@link RecoveryOrchestrator.completeRecovery}.
 *
 * The structural separation makes it impossible to accidentally treat a
 * recovery token as an authentication credential.
 */
@Injectable()
export class RecoverySessionService {
  constructor(
    private readonly options: RecoverySessionServiceOptions,
    private readonly cache: CacheProvider,
  ) {}

  private getKey(token: string) {
    return `recovery_session_${token}`;
  }

  private serialize(payload: RecoverySessionPayload): string {
    const shape: RecoverySessionPayloadShape = {
      recoverySessionToken: payload.recoverySessionToken,
      actor: payload.actor,
      reason: payload.reason,
      verifiedVia: payload.verifiedVia,
      grantedActions: payload.grantedActions,
      issuedAt: payload.issuedAt.toUnixInteger(),
      expiresAt: payload.expiresAt.toUnixInteger(),
    };
    return JSON.stringify(shape);
  }

  private deserialize(data: string): RecoverySessionPayload {
    const shape = JSON.parse(data) as RecoverySessionPayloadShape;
    return {
      recoverySessionToken: shape.recoverySessionToken,
      actor: shape.actor,
      reason: shape.reason,
      verifiedVia: shape.verifiedVia,
      grantedActions: shape.grantedActions,
      issuedAt: DateTime.fromSeconds(shape.issuedAt),
      expiresAt: DateTime.fromSeconds(shape.expiresAt),
    };
  }

  /**
   * Issue a new recovery session, opaque to the consumer, and store it in cache.
   */
  async issue(input: Pick<RecoverySessionPayload, 'actor' | 'reason' | 'verifiedVia' | 'grantedActions'>): Promise<RecoverySessionPayload> {
    const recoverySessionToken = crypto.randomBytes(32).toString('base64url');
    const issuedAt = DateTime.utc();
    const expiresAt = issuedAt.plus(this.options.ttl);

    const payload: RecoverySessionPayload = {
      recoverySessionToken,
      actor: input.actor,
      reason: input.reason,
      verifiedVia: input.verifiedVia,
      grantedActions: input.grantedActions,
      issuedAt,
      expiresAt,
    };

    await this.cache.set(this.getKey(recoverySessionToken), this.serialize(payload), this.options.ttl);
    return payload;
  }

  /**
   * Look up a recovery session without consuming it. Returns `null` when the
   * session has expired or does not exist.
   */
  async peek(token: string): Promise<RecoverySessionPayload | null> {
    const data = await this.cache.get(this.getKey(token));
    return data ? this.deserialize(data) : null;
  }

  /**
   * Look up and delete a recovery session in the same call. Returns `null`
   * when the session has expired or does not exist. Recovery sessions are
   * single-use; the orchestrator always redeems on
   * {@link RecoveryOrchestrator.completeRecovery}.
   */
  async redeem(token: string): Promise<RecoverySessionPayload | null> {
    const data = await this.cache.get(this.getKey(token));
    if (!data) return null;
    await this.cache.delete(this.getKey(token));
    return this.deserialize(data);
  }
}
