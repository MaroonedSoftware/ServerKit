import { describe, it, expect } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { AuthRecentFactorPolicyContext, DefaultRecentFactorPolicy } from '../../src/policies/auth.recent.factor.policy.js';
import { AuthenticationFactorKind, AuthenticationFactorMethod, AuthenticationSessionFactor } from '../../src/types.js';

const now = DateTime.utc(2026, 5, 12, 12, 0, 0);
const envelope = { now };

const policy = new DefaultRecentFactorPolicy();

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

const evaluate = (context: AuthRecentFactorPolicyContext) => policy.evaluate(context, envelope);

const fiveMinutes = Duration.fromObject({ minutes: 5 });

describe('DefaultRecentFactorPolicy', () => {
  it('allows when at least one factor is recent enough and matches no constraints', async () => {
    const result = await evaluate({
      factors: [factor('password', 'knowledge', now.minus({ minutes: 1 }))],
      within: fiveMinutes,
    });
    expect(result).toEqual({ allowed: true });
  });

  it('denies with a step-up requirement when no factors are present', async () => {
    const result = await evaluate({ factors: [], within: fiveMinutes });
    expect(result).toEqual({
      allowed: false,
      reason: 'no recent factor satisfies the step-up requirement',
      details: { kind: 'step_up_required', stepUp: { within: fiveMinutes } },
    });
  });

  it('denies when every factor is older than the window', async () => {
    const result = await evaluate({
      factors: [factor('password', 'knowledge', now.minus({ minutes: 30 }))],
      within: fiveMinutes,
    });
    expect(result.allowed).toBe(false);
    expect((result as { details: { kind: string } }).details.kind).toBe('step_up_required');
  });

  it('filters by anyOfKinds — denies when no recent factor matches the required kinds', async () => {
    const result = await evaluate({
      factors: [factor('password', 'knowledge', now.minus({ minutes: 1 }))],
      within: fiveMinutes,
      anyOfKinds: ['possession', 'biometric'],
    });
    expect(result.allowed).toBe(false);
    expect((result as { details: { stepUp: { acceptableKinds: ReadonlyArray<string> } } }).details.stepUp.acceptableKinds).toEqual([
      'possession',
      'biometric',
    ]);
  });

  it('filters by anyOfMethods — allows when a recent factor matches one of the methods', async () => {
    const result = await evaluate({
      factors: [factor('phone', 'possession', now.minus({ minutes: 2 }))],
      within: fiveMinutes,
      anyOfMethods: ['phone', 'fido'],
    });
    expect(result).toEqual({ allowed: true });
  });

  it('filters by excludeMethods — denies when the only recent factor is on the exclusion list', async () => {
    const result = await evaluate({
      factors: [factor('email', 'possession', now.minus({ minutes: 1 }))],
      within: fiveMinutes,
      excludeMethods: ['email'],
    });
    expect(result.allowed).toBe(false);
    expect((result as { details: { stepUp: { excludeMethods: ReadonlyArray<string> } } }).details.stepUp.excludeMethods).toEqual(['email']);
  });

  it('combines anyOfKinds and excludeMethods correctly', async () => {
    const result = await evaluate({
      factors: [
        factor('email', 'possession', now.minus({ minutes: 1 }), 'email-1'),
        factor('phone', 'possession', now.minus({ minutes: 1 }), 'phone-1'),
      ],
      within: fiveMinutes,
      anyOfKinds: ['possession'],
      excludeMethods: ['email'],
    });
    expect(result).toEqual({ allowed: true });
  });

  it('embeds all set constraints in the step-up requirement on deny', async () => {
    const result = await evaluate({
      factors: [],
      within: fiveMinutes,
      anyOfKinds: ['possession'],
      anyOfMethods: ['fido', 'phone'],
      excludeMethods: ['email'],
    });
    expect(result).toEqual({
      allowed: false,
      reason: 'no recent factor satisfies the step-up requirement',
      details: {
        kind: 'step_up_required',
        stepUp: {
          within: fiveMinutes,
          acceptableKinds: ['possession'],
          acceptableMethods: ['fido', 'phone'],
          excludeMethods: ['email'],
        },
      },
    });
  });
});
