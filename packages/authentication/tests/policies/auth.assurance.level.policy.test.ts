import { describe, it, expect } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { AuthAssuranceLevelPolicyContext, DefaultAssuranceLevelPolicy } from '../../src/policies/auth.assurance.level.policy.js';
import { AuthenticationFactorKind, AuthenticationFactorMethod, AuthenticationSessionFactor } from '../../src/types.js';

const now = DateTime.utc(2026, 5, 12, 12, 0, 0);
const envelope = { now };

const policy = new DefaultAssuranceLevelPolicy();

const factor = (
  method: AuthenticationFactorMethod,
  kind: AuthenticationFactorKind,
  authenticatedAt: DateTime,
  methodId = `${method}-1`,
): AuthenticationSessionFactor => ({
  method,
  methodId,
  kind,
  issuedAt: authenticatedAt,
  authenticatedAt,
});

const evaluate = (context: AuthAssuranceLevelPolicyContext) => policy.evaluate(context, envelope);

const fiveMinutes = Duration.fromObject({ minutes: 5 });

describe('DefaultAssuranceLevelPolicy', () => {
  describe('aal1', () => {
    it('allows when at least one factor was verified recently', async () => {
      const result = await evaluate({
        factors: [factor('password', 'knowledge', now.minus({ minutes: 1 }))],
        minLevel: 'aal1',
        within: fiveMinutes,
      });
      expect(result).toEqual({ allowed: true });
    });

    it('denies with step-up requirement when no factors are present', async () => {
      const result = await evaluate({ factors: [], minLevel: 'aal1', within: fiveMinutes });
      expect(result).toMatchObject({
        allowed: false,
        reason: 'current session does not meet aal1',
        details: {
          kind: 'step_up_required',
          stepUp: { within: fiveMinutes, acceptableKinds: ['knowledge', 'possession', 'biometric'] },
        },
        headers: { 'WWW-Authenticate': 'Bearer error="aal1_required"' },
      });
    });

    it('denies when every factor is stale', async () => {
      const result = await evaluate({
        factors: [factor('password', 'knowledge', now.minus({ minutes: 30 }))],
        minLevel: 'aal1',
        within: fiveMinutes,
      });
      expect(result.allowed).toBe(false);
    });

    it('uses a 15-minute default window when `within` is omitted', async () => {
      const result = await evaluate({
        factors: [factor('password', 'knowledge', now.minus({ minutes: 10 }))],
        minLevel: 'aal1',
      });
      // 10 minutes ago is inside the default 15-minute window.
      expect(result).toEqual({ allowed: true });
    });
  });

  describe('aal2', () => {
    it('allows the classic knowledge + possession combo', async () => {
      const result = await evaluate({
        factors: [
          factor('password', 'knowledge', now.minus({ minutes: 1 })),
          factor('phone', 'possession', now.minus({ minutes: 1 })),
        ],
        minLevel: 'aal2',
        within: fiveMinutes,
      });
      expect(result).toEqual({ allowed: true });
    });

    it('allows the knowledge + biometric combo', async () => {
      const result = await evaluate({
        factors: [
          factor('password', 'knowledge', now.minus({ minutes: 1 })),
          factor('fido', 'biometric', now.minus({ minutes: 1 })),
        ],
        minLevel: 'aal2',
        within: fiveMinutes,
      });
      expect(result).toEqual({ allowed: true });
    });

    it('allows the passwordless path with two distinct non-knowledge factors', async () => {
      const result = await evaluate({
        factors: [
          factor('fido', 'possession', now.minus({ minutes: 1 }), 'fido-1'),
          factor('authenticator', 'possession', now.minus({ minutes: 1 }), 'auth-1'),
        ],
        minLevel: 'aal2',
        within: fiveMinutes,
      });
      expect(result).toEqual({ allowed: true });
    });

    it('rejects the passwordless path when both non-knowledge factors share method+methodId', async () => {
      // Same FIDO key authenticated twice — distinctness keyed on (method, methodId).
      const result = await evaluate({
        factors: [
          factor('fido', 'possession', now.minus({ minutes: 2 }), 'fido-1'),
          factor('fido', 'possession', now.minus({ minutes: 1 }), 'fido-1'),
        ],
        minLevel: 'aal2',
        within: fiveMinutes,
      });
      expect(result.allowed).toBe(false);
    });

    it('denies aal2 with a single knowledge factor — and points the client at possession/biometric step-up', async () => {
      const result = await evaluate({
        factors: [factor('password', 'knowledge', now.minus({ minutes: 1 }))],
        minLevel: 'aal2',
        within: fiveMinutes,
      });
      expect(result).toMatchObject({
        allowed: false,
        reason: 'current session does not meet aal2',
        details: {
          kind: 'step_up_required',
          stepUp: { within: fiveMinutes, acceptableKinds: ['possession', 'biometric'] },
        },
        headers: { 'WWW-Authenticate': 'Bearer error="aal2_required"' },
      });
    });

    it('denies aal2 with a single non-knowledge factor — points the client at any kind (knowledge OR a second non-knowledge)', async () => {
      const result = await evaluate({
        factors: [factor('fido', 'possession', now.minus({ minutes: 1 }))],
        minLevel: 'aal2',
        within: fiveMinutes,
      });
      expect(result).toMatchObject({
        allowed: false,
        reason: 'current session does not meet aal2',
        details: {
          kind: 'step_up_required',
          stepUp: { within: fiveMinutes, acceptableKinds: ['knowledge', 'possession', 'biometric'] },
        },
        headers: { 'WWW-Authenticate': 'Bearer error="aal2_required"' },
      });
    });

    it('ignores stale factors when computing aal2', async () => {
      // Knowledge factor is fresh, possession factor is stale — aal2 should deny.
      const result = await evaluate({
        factors: [
          factor('password', 'knowledge', now.minus({ minutes: 1 })),
          factor('phone', 'possession', now.minus({ minutes: 30 })),
        ],
        minLevel: 'aal2',
        within: fiveMinutes,
      });
      expect(result.allowed).toBe(false);
    });
  });
});
