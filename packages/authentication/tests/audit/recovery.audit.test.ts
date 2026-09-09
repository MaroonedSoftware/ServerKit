import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { RecoveryOrchestrator, RecoveryOrchestratorHooksProvider } from '../../src/recovery/recovery.orchestrator.js';
import type { RecoveryChallengeService } from '../../src/recovery/recovery.challenge.service.js';
import type { RecoverySessionService } from '../../src/recovery/recovery.session.service.js';
import type { EmailFactorService } from '../../src/factors/email/email.factor.service.js';
import type { PhoneFactorService } from '../../src/factors/phone/phone.factor.service.js';
import type { PasswordFactorService } from '../../src/factors/password/password.factor.service.js';
import type { RecoveryFactorService } from '../../src/factors/recovery/recovery.factor.service.js';
import type { AuthenticationSessionService } from '../../src/authentication.session.service.js';
import { AuditRecorder } from '../../src/audit/audit.recorder.js';
import { AuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';

const CODE = '123456';
const expiresAt = DateTime.utc().plus({ minutes: 10 });

let events: AuthenticationAuditEvent[];
let challenge: Record<string, unknown> | undefined;
let policyResult: PolicyResult;
let emailFactor: { id: string; actorId: string; value: string } | undefined;

const makeChallengeService = () =>
  ({
    issue: vi.fn(async () => ({ challengeId: 'rc-1', expiresAt })),
    peek: vi.fn(async () => challenge),
    redeem: vi.fn(async () => true),
    attachChannelSelection: vi.fn(async () => undefined),
  }) as unknown as RecoveryChallengeService;

const makeSessionService = () =>
  ({
    issue: vi.fn(async () => ({ recoverySessionToken: 'rs-1', expiresAt })),
    peek: vi.fn(async () => undefined),
    redeem: vi.fn(async () => true),
  }) as unknown as RecoverySessionService;

const makeEmailFactorService = () =>
  ({
    findFactor: vi.fn(async () => emailFactor),
    listFactors: vi.fn(async () => (emailFactor ? [emailFactor] : [])),
    issueEmailChallenge: vi.fn(async () => ({ challengeId: 'ec-1', code: CODE, email: 'a@example.com', expiresAt, alreadyIssued: false })),
    verifyEmailChallenge: vi.fn(async () => ({ id: 'ef-1' })),
  }) as unknown as EmailFactorService;

const build = (authSessions?: AuthenticationSessionService) => {
  const sink = { record: (e: AuthenticationAuditEvent) => void events.push(e) } as unknown as AuditSink;
  return new RecoveryOrchestrator(
    makeChallengeService(),
    makeSessionService(),
    { check: vi.fn(async () => policyResult), assert: vi.fn(async () => undefined) } as unknown as PolicyService,
    makeEmailFactorService(),
    { listFactors: vi.fn(async () => []) } as unknown as PhoneFactorService,
    { changePassword: vi.fn(async () => undefined), clearRateLimit: vi.fn(async () => undefined) } as unknown as PasswordFactorService,
    { countRemainingCodes: vi.fn(async () => 0) } as unknown as RecoveryFactorService,
    new RecoveryOrchestratorHooksProvider(),
    authSessions,
    new AuditRecorder(sink),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  policyResult = { allowed: true };
  emailFactor = { id: 'ef-1', actorId: 'user-1', value: 'a@example.com' };
  challenge = {
    challengeId: 'rc-1',
    actor: { kind: 'user', actorId: 'user-1' },
    reason: 'password_reset',
    eligibleChannels: [{ channel: 'email', methodId: 'ef-1', label: 'a***@example.com' }],
    selectedChannel: 'email',
    channelChallengeId: 'ec-1',
    expiresAt,
  };
});

describe('recovery initiation', () => {
  it('records a resolved actor', async () => {
    await build().initiateRecovery({ identifier: { kind: 'email', value: 'a@example.com' }, reason: 'password_reset' });

    expect(events).toMatchObject([
      { type: 'recovery.initiated', category: 'recovery', actorId: 'user-1', data: { reason: 'password_reset', actorResolved: true } },
    ]);
  });

  it('records an unresolved identifier as a probe', async () => {
    emailFactor = undefined;

    await build().initiateRecovery({ identifier: { kind: 'email', value: 'nobody@example.com' }, reason: 'password_reset' });

    // The package still issues a challenge so a caller cannot enumerate accounts,
    // which means an event with no actor is someone testing addresses.
    expect(events[0]).toMatchObject({ type: 'recovery.initiated', data: { actorResolved: false, eligibleChannelCount: 0 } });
    expect(events[0]!.actorId).toBeUndefined();
  });

  it('records a policy refusal', async () => {
    policyResult = { allowed: false, reason: 'recovery_disabled' };

    await expect(build().initiateRecovery({ identifier: { kind: 'email', value: 'a@example.com' }, reason: 'password_reset' })).rejects.toMatchObject(
      { statusCode: 403 },
    );

    expect(events).toMatchObject([{ type: 'recovery.policy_denied', outcome: 'failure', data: { policyReason: 'recovery_disabled' } }]);
  });

  it('never records the recovery code it dispatches', async () => {
    await build().issueChannelChallenge('rc-1', { channel: 'email', methodId: 'ef-1' });

    expect(events).toMatchObject([{ type: 'recovery.channel.issued', data: { channel: 'email', methodId: 'ef-1' } }]);
    expect(JSON.stringify(events)).not.toContain(CODE);
  });
});

describe('recovery verification', () => {
  it('records a verified channel with the actions it granted', async () => {
    await build().verifyChannel('rc-1', { channel: 'email', channelChallengeId: 'ec-1', code: CODE });

    expect(events).toMatchObject([
      {
        type: 'recovery.channel.verified',
        category: 'privilege',
        actorId: 'user-1',
        data: { channel: 'email', grantedActions: ['resetPassword'] },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(CODE);
  });

  it('records a cross-account sub-challenge as its own reason', async () => {
    // A proof issued against the attacker's own factor, presented on a challenge
    // bound to the victim. No legitimate client does this.
    await expect(build().verifyChannel('rc-1', { channel: 'email', channelChallengeId: 'attacker-ec', code: CODE })).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(events).toMatchObject([
      { type: 'recovery.channel.rejected', outcome: 'failure', actorId: 'user-1', data: { reason: 'sub_challenge_mismatch' } },
    ]);
  });

  it('records a missing challenge and a channel mismatch distinctly', async () => {
    challenge = undefined;
    await expect(build().verifyChannel('rc-1', { channel: 'email', channelChallengeId: 'ec-1', code: CODE })).rejects.toThrow();
    expect(events[0]).toMatchObject({ type: 'recovery.channel.rejected', data: { reason: 'challenge_not_found' } });
  });
});

describe('recovery completion', () => {
  const session = { actor: { kind: 'user', actorId: 'user-1' }, reason: 'password_reset', grantedActions: ['resetPassword'], expiresAt };

  const buildForCompletion = (authSessions?: AuthenticationSessionService) => {
    const orchestrator = build(authSessions);
    (orchestrator as unknown as { sessionService: RecoverySessionService }).sessionService = {
      peek: vi.fn(async () => session),
      redeem: vi.fn(async () => true),
      issue: vi.fn(),
    } as unknown as RecoverySessionService;
    return orchestrator;
  };

  it('records the credential change and the sessions it revoked', async () => {
    const authSessions = { revokeAllForSubject: vi.fn(async () => 3) } as unknown as AuthenticationSessionService;

    await buildForCompletion(authSessions).completeRecovery('rs-1', { kind: 'resetPassword', newPassword: 'a new passphrase here' });

    expect(events.map(e => e.type)).toEqual(['recovery.sessions_revoked', 'recovery.completed']);
    expect(events[0]).toMatchObject({ data: { action: 'resetPassword', count: 3 } });
  });

  it('records that prior sessions were left alive when no session service was bound', async () => {
    await buildForCompletion(undefined).completeRecovery('rs-1', { kind: 'resetPassword', newPassword: 'a new passphrase here' });

    // The optional dependency silently no-ops today. This event is the only way
    // that misconfiguration is visible.
    expect(events[0]).toMatchObject({ type: 'recovery.sessions_not_revoked', data: { action: 'resetPassword' } });
  });

  it('never records the new password', async () => {
    await buildForCompletion(undefined).completeRecovery('rs-1', { kind: 'resetPassword', newPassword: 'a new passphrase here' });

    expect(JSON.stringify(events)).not.toContain('a new passphrase here');
  });
});
