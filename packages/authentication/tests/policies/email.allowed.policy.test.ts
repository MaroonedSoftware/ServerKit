import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { EmailAllowedPolicy, EmailAllowedPolicyOptions } from '../../src/policies/email.allowed.policy.js';

const envelope = { now: DateTime.utc() };

const makePolicy = (emailDomainDenyList: string[] = []) => new EmailAllowedPolicy(new EmailAllowedPolicyOptions(emailDomainDenyList));

describe('EmailAllowedPolicy', () => {
  it('allows a well-formed email whose domain is not on the deny list', async () => {
    await expect(makePolicy().evaluate({ value: 'user@example.com' }, envelope)).resolves.toEqual({ allowed: true });
  });

  it("denies with reason 'invalid_format' for malformed input", async () => {
    await expect(makePolicy().evaluate({ value: 'not-an-email' }, envelope)).resolves.toEqual({ allowed: false, reason: 'invalid_format' });
  });

  it("denies with reason 'deny_list' when the domain is on the deny list", async () => {
    const policy = makePolicy(['disposable.com', 'tempmail.org']);
    await expect(policy.evaluate({ value: 'user@disposable.com' }, envelope)).resolves.toEqual({ allowed: false, reason: 'deny_list' });
  });

  it('matches deny-list entries via binary search (requires sorted list)', async () => {
    // tempmail.org > disposable.com lexicographically; binarySearch needs the list sorted ascending.
    const policy = makePolicy(['disposable.com', 'tempmail.org']);
    await expect(policy.evaluate({ value: 'user@tempmail.org' }, envelope)).resolves.toEqual({ allowed: false, reason: 'deny_list' });
  });

  it('allows an email whose domain is not on a populated deny list', async () => {
    const policy = makePolicy(['disposable.com']);
    await expect(policy.evaluate({ value: 'user@example.com' }, envelope)).resolves.toEqual({ allowed: true });
  });
});
