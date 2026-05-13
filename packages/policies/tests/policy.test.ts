import { describe, it, expect } from 'vitest';
import { DateTime, Duration } from 'luxon';
import {
  isPolicyResultAllowed,
  isPolicyResultDenied,
  Policy,
  type PolicyEnvelope,
  type PolicyResult,
  type StepUpRequirement,
} from '../src/policy.js';

const envelope: PolicyEnvelope = { now: DateTime.fromISO('2026-01-01T00:00:00Z', { zone: 'utc' }) };

interface TestPolicyContext {
  allow: boolean;
  reason?: string;
  stepUp?: StepUpRequirement;
  details?: Record<string, unknown>;
  internalDetails?: Record<string, unknown>;
}

class TestPolicy extends Policy<TestPolicyContext> {
  async evaluate(context: TestPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    if (context.allow) return this.allow();
    if (context.stepUp) return this.denyStepUp(context.reason ?? 'step_up_required', context.stepUp);
    return this.deny(
      context.reason ?? 'denied',
      context.details ?? { extra: 1 },
      context.internalDetails,
    );
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

  it('deny() round-trips internalDetails through PolicyResultDenied', async () => {
    const result = await new TestPolicy().evaluate(
      {
        allow: false,
        reason: 'nope',
        details: { hint: 'visible' },
        internalDetails: { traceId: 'abc-123' },
      },
      envelope,
    );
    expect(result).toEqual({
      allowed: false,
      reason: 'nope',
      details: { hint: 'visible' },
      internalDetails: { traceId: 'abc-123' },
    });
  });

  it("denyStepUp() wraps the requirement under details.stepUp with kind='step_up_required'", async () => {
    const requirement: StepUpRequirement = { within: Duration.fromObject({ seconds: 60 }), acceptableMethods: ['fido'] };
    const result = await new TestPolicy().evaluate({ allow: false, reason: 'recent_auth_required', stepUp: requirement }, envelope);
    expect(result).toEqual({
      allowed: false,
      reason: 'recent_auth_required',
      details: { kind: 'step_up_required', stepUp: requirement },
    });
  });

  it('deny().withHeaders() attaches headers to the denial', async () => {
    class HeaderPolicy extends Policy<{ allow: boolean }> {
      async evaluate(context: { allow: boolean }): Promise<PolicyResult> {
        if (context.allow) return this.allow();
        return this.deny('mfa_required').withHeaders({ 'WWW-Authenticate': 'Bearer error="mfa_required"' });
      }
    }
    const result = await new HeaderPolicy().evaluate({ allow: false }, envelope);
    expect(result).toMatchObject({
      allowed: false,
      reason: 'mfa_required',
      headers: { 'WWW-Authenticate': 'Bearer error="mfa_required"' },
    });
  });

  it('denyStepUp().withHeaders() composes with the step-up details', async () => {
    class StepUpHeaderPolicy extends Policy<{ allow: boolean }> {
      async evaluate(context: { allow: boolean }): Promise<PolicyResult> {
        if (context.allow) return this.allow();
        return this.denyStepUp('aal2_required', { within: Duration.fromObject({ minutes: 15 }) }).withHeaders({
          'WWW-Authenticate': 'Bearer error="aal2_required"',
        });
      }
    }
    const result = await new StepUpHeaderPolicy().evaluate({ allow: false }, envelope);
    expect(result).toMatchObject({
      allowed: false,
      reason: 'aal2_required',
      details: { kind: 'step_up_required', stepUp: { within: Duration.fromObject({ minutes: 15 }) } },
      headers: { 'WWW-Authenticate': 'Bearer error="aal2_required"' },
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
