import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { MfaOrchestrator } from '../../src/mfa/mfa.orchestrator.js';
import type { MfaChallengeService } from '../../src/mfa/mfa.challenge.service.js';
import type { PhoneFactorService } from '../../src/factors/phone/phone.factor.service.js';
import type { FidoFactorService } from '../../src/factors/fido/fido.factor.service.js';
import type { AuthenticatorFactorService } from '../../src/factors/authenticator/authenticator.factor.service.js';
import type { EmailFactorService } from '../../src/factors/email/email.factor.service.js';
import { AuditRecorder } from '../../src/audit/audit.recorder.js';
import { AuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';
import type { AuthenticationSessionFactor } from '../../src/types.js';

const now = DateTime.utc();
const primaryFactor: AuthenticationSessionFactor = { method: 'password', methodId: 'pw-1', kind: 'knowledge', issuedAt: now, authenticatedAt: now };
const actor = { kind: 'user', actorId: 'user-1' } as const;
const eligible = [{ method: 'authenticator' as const, methodId: 'auth-1' }];

let events: AuthenticationAuditEvent[];
let policyResult: PolicyResult;
let challenge: Record<string, unknown> | null;
let lockGranted: boolean;
let verifyThrows: boolean;

const build = () => {
  const sink = { record: (e: AuthenticationAuditEvent) => void events.push(e) } as unknown as AuditSink;
  return new MfaOrchestrator(
    {
      issue: vi.fn(async () => ({ challengeId: 'mfa-1', actor, primaryFactor, eligibleFactors: eligible, expiresAt: now.plus({ minutes: 5 }) })),
      peek: vi.fn(async () => challenge),
      redeem: vi.fn(async () => true),
      lockForCompletion: vi.fn(async () => lockGranted),
      releaseCompletionLock: vi.fn(async () => undefined),
    } as unknown as MfaChallengeService,
    { check: vi.fn(async () => policyResult), assert: vi.fn(async () => undefined) } as unknown as PolicyService,
    {} as PhoneFactorService,
    {} as FidoFactorService,
    {
      validateFactor: vi.fn(async () => {
        if (verifyThrows) throw new Error('wrong code');
        return { id: 'auth-1', actorId: 'user-1' };
      }),
    } as unknown as AuthenticatorFactorService,
    {} as EmailFactorService,
    new AuditRecorder(sink),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  policyResult = { allowed: false, reason: 'mfa_required', details: { eligibleFactors: eligible } };
  lockGranted = true;
  verifyThrows = false;
  challenge = { challengeId: 'mfa-1', actor, primaryFactor, eligibleFactors: eligible, expiresAt: now.plus({ minutes: 5 }) };
});

describe('the MFA gate', () => {
  it('records a demanded second factor with what would satisfy it', async () => {
    await build().issueOrChallenge(actor, primaryFactor, []);

    expect(events).toMatchObject([
      { type: 'mfa.challenge.issued', category: 'privilege', actorId: 'user-1', data: { mfaChallengeId: 'mfa-1', eligibleFactors: eligible } },
    ]);
  });

  it('records a skipped step-up, because that is a decision too', async () => {
    policyResult = { allowed: true };

    await build().issueOrChallenge(actor, primaryFactor, []);

    // An auditor reviewing an incident needs to see MFA was not demanded, not
    // only that it was satisfied when it was.
    expect(events).toMatchObject([
      { type: 'mfa.challenge.skipped', category: 'privilege', actorId: 'user-1', data: { primaryFactor: { method: 'password', methodId: 'pw-1' } } },
    ]);
  });
});

describe('MFA completion', () => {
  it('records a satisfied second factor naming both', async () => {
    await build().completeMfa('mfa-1', { method: 'authenticator', methodId: 'auth-1', code: '123456' });

    expect(events).toMatchObject([
      {
        type: 'mfa.completed',
        category: 'login',
        outcome: 'success',
        actorId: 'user-1',
        data: { primaryFactor: { method: 'password' }, secondaryFactor: { method: 'authenticator', methodId: 'auth-1' } },
      },
    ]);
  });

  it('records a rejected proof', async () => {
    verifyThrows = true;

    await expect(build().completeMfa('mfa-1', { method: 'authenticator', methodId: 'auth-1', code: 'bad' })).rejects.toThrow();

    expect(events).toMatchObject([{ type: 'mfa.failed', outcome: 'failure', actorId: 'user-1', data: { reason: 'proof_rejected' } }]);
  });

  it('records a concurrent completion distinctly from a wrong proof', async () => {
    lockGranted = false;

    await expect(build().completeMfa('mfa-1', { method: 'authenticator', methodId: 'auth-1', code: '123456' })).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(events).toMatchObject([{ type: 'mfa.failed', data: { reason: 'completion_in_flight' } }]);
  });

  it('records a proof aimed at a factor the challenge never offered', async () => {
    await expect(build().completeMfa('mfa-1', { method: 'authenticator', methodId: 'other', code: '123456' })).rejects.toThrow();

    expect(events).toMatchObject([{ type: 'mfa.failed', data: { reason: 'method_id_mismatch', method: 'authenticator' } }]);
  });

  it('records a missing challenge without inventing an actor', async () => {
    challenge = null;

    await expect(build().completeMfa('mfa-1', { method: 'authenticator', methodId: 'auth-1', code: '123456' })).rejects.toThrow();

    expect(events[0]).toMatchObject({ type: 'mfa.failed', data: { reason: 'challenge_not_found' } });
    expect(events[0]!.actorId).toBeUndefined();
  });

  it('never records the code a proof carried', async () => {
    await build().completeMfa('mfa-1', { method: 'authenticator', methodId: 'auth-1', code: '123456' });

    expect(JSON.stringify(events)).not.toContain('123456');
  });
});
