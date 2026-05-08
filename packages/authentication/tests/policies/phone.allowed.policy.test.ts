import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { PhoneAllowedPolicy } from '../../src/policies/phone.allowed.policy.js';

const envelope = { now: DateTime.utc() };

describe('PhoneAllowedPolicy', () => {
  it('allows a valid E.164 phone number', async () => {
    await expect(new PhoneAllowedPolicy().evaluate({ value: '+12025550123' }, envelope)).resolves.toEqual({ allowed: true });
  });

  it("denies with reason 'invalid_format' for non-E.164 input", async () => {
    await expect(new PhoneAllowedPolicy().evaluate({ value: 'not-a-phone' }, envelope)).resolves.toEqual({
      allowed: false,
      reason: 'invalid_format',
    });
  });
});
