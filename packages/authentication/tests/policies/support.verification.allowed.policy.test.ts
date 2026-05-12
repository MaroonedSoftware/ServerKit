import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { SupportVerificationAllowedPolicy } from '../../src/policies/support.verification.allowed.policy.js';

const envelope = { now: DateTime.utc() };
const policy = new SupportVerificationAllowedPolicy();
const actor = { kind: 'user', actorId: 'user-1' };

describe('SupportVerificationAllowedPolicy', () => {
  it('denies when actor is missing', async () => {
    const result = await policy.evaluate({ operation: 'issue' }, envelope);
    expect(result).toEqual({ allowed: false, reason: 'actor_unknown' });
  });

  it('allows an authenticated actor to issue', async () => {
    const result = await policy.evaluate({ operation: 'issue', actor }, envelope);
    expect(result).toEqual({ allowed: true });
  });

  it('allows an authenticated actor to verify', async () => {
    const result = await policy.evaluate({ operation: 'verify', actor }, envelope);
    expect(result).toEqual({ allowed: true });
  });
});
