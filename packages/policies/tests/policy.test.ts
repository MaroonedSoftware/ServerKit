import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  isPolicyResultAllowed,
  isPolicyResultDenied,
  Policy,
  type PolicyEnvelope,
  type PolicyResult,
  type StepUpRequirement,
} from '../src/policy.js';

const envelope: PolicyEnvelope = { now: DateTime.fromISO('2026-01-01T00:00:00Z', { zone: 'utc' }) };

class TestPolicy extends Policy<{ allow: boolean; reason?: string; stepUp?: StepUpRequirement }> {
  async evaluate(
    context: { allow: boolean; reason?: string; stepUp?: StepUpRequirement },
    _envelope: PolicyEnvelope,
  ): Promise<PolicyResult> {
    if (context.allow) return this.allow();
    if (context.stepUp) return this.denyStepUp(context.reason ?? 'step_up_required', context.stepUp);
    return this.deny(context.reason ?? 'denied', { extra: 1 });
  }
}

describe('Policy', () => {
  it('allow() returns { allowed: true }', async () => {
    await expect(new TestPolicy().evaluate({ allow: true }, envelope)).resolves.toEqual({ allowed: true });
  });

  it('deny() returns { allowed: false, reason, details }', async () => {
    await expect(new TestPolicy().evaluate({ allow: false, reason: 'nope' }, envelope)).resolves.toEqual({
      allowed: false,
      reason: 'nope',
      details: { extra: 1 },
    });
  });

  it("denyStepUp() wraps the requirement under details.stepUp with kind='step_up_required'", async () => {
    const requirement: StepUpRequirement = { withinSeconds: 60, acceptableMethods: ['fido'] };
    const result = await new TestPolicy().evaluate({ allow: false, reason: 'recent_auth_required', stepUp: requirement }, envelope);
    expect(result).toEqual({
      allowed: false,
      reason: 'recent_auth_required',
      details: { kind: 'step_up_required', stepUp: requirement },
    });
  });
});

describe('PolicyResult type guards', () => {
  it('isPolicyResultAllowed narrows to the allowed branch', () => {
    const result: PolicyResult = { allowed: true };
    expect(isPolicyResultAllowed(result)).toBe(true);
    expect(isPolicyResultDenied(result)).toBe(false);
  });

  it('isPolicyResultDenied narrows to the denied branch', () => {
    const result: PolicyResult = { allowed: false, reason: 'nope' };
    expect(isPolicyResultDenied(result)).toBe(true);
    expect(isPolicyResultAllowed(result)).toBe(false);
  });
});
