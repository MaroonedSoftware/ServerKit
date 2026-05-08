import { describe, it, expect } from 'vitest';
import { AllowlistProvider, AllowlistProviderOptions } from '../../src/providers/allowlist.provider.js';

const makeProvider = (emailDomainDenyList: string[] = []) =>
  new AllowlistProvider(new AllowlistProviderOptions(emailDomainDenyList));

describe('AllowlistProvider', () => {
  describe('checkEmailIsAllowed', () => {
    it('returns { allowed: true } for a well-formed email not on the deny list', async () => {
      await expect(makeProvider().checkEmailIsAllowed('user@example.com')).resolves.toEqual({ allowed: true });
    });

    it("returns { allowed: false, reason: 'invalid_format' } for malformed input", async () => {
      await expect(makeProvider().checkEmailIsAllowed('not-an-email')).resolves.toEqual({
        allowed: false,
        reason: 'invalid_format',
      });
    });

    it("returns { allowed: false, reason: 'deny_list' } when the domain is on the deny list", async () => {
      await expect(makeProvider(['disposable.com', 'tempmail.org']).checkEmailIsAllowed('user@disposable.com')).resolves.toEqual({
        allowed: false,
        reason: 'deny_list',
      });
    });

    it('matches deny list entries via binary search (requires sorted list)', async () => {
      // tempmail.org > disposable.com lexicographically; binarySearch needs the list sorted ascending.
      const result = await makeProvider(['disposable.com', 'tempmail.org']).checkEmailIsAllowed('user@tempmail.org');
      expect(result).toEqual({ allowed: false, reason: 'deny_list' });
    });

    it('allows emails whose domain is not on the deny list', async () => {
      await expect(makeProvider(['disposable.com']).checkEmailIsAllowed('user@example.com')).resolves.toEqual({ allowed: true });
    });
  });

  describe('checkPhoneIsAllowed', () => {
    it('returns { allowed: true } for a valid E.164 phone number', async () => {
      await expect(makeProvider().checkPhoneIsAllowed('+12025550123')).resolves.toEqual({ allowed: true });
    });

    it("returns { allowed: false, reason: 'invalid_format' } for non-E.164 input", async () => {
      await expect(makeProvider().checkPhoneIsAllowed('not-a-phone')).resolves.toEqual({
        allowed: false,
        reason: 'invalid_format',
      });
    });
  });
});
