import { describe, it, expect } from 'vitest';
import { AllowlistProvider, AllowlistProviderOptions } from '../../src/providers/allowlist.provider.js';

const makeProvider = (emailDomainDenyList: string[] = []) =>
  new AllowlistProvider(new AllowlistProviderOptions(emailDomainDenyList));

describe('AllowlistProvider', () => {
  describe('ensureEmailIsAllowed', () => {
    it('resolves for a well-formed email not on the deny list', async () => {
      await expect(makeProvider().ensureEmailIsAllowed('user@example.com')).resolves.toBeUndefined();
    });

    it('throws 400 when the email is malformed', async () => {
      await expect(makeProvider().ensureEmailIsAllowed('not-an-email')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'invalid email format' },
      });
    });

    it('throws 400 when the domain is on the deny list', async () => {
      await expect(makeProvider(['disposable.com', 'tempmail.org']).ensureEmailIsAllowed('user@disposable.com')).rejects.toMatchObject({
        statusCode: 400,
        details: { email: 'Must not be a disposable email' },
      });
    });

    it('matches deny list entries via binary search (requires sorted list)', async () => {
      // tempmail.org > disposable.com lexicographically; binarySearch needs the list sorted ascending.
      const provider = makeProvider(['disposable.com', 'tempmail.org']);
      await expect(provider.ensureEmailIsAllowed('user@tempmail.org')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('allows emails whose domain is not on the deny list', async () => {
      await expect(makeProvider(['disposable.com']).ensureEmailIsAllowed('user@example.com')).resolves.toBeUndefined();
    });
  });

  describe('ensurePhoneIsAllowed', () => {
    it('resolves for a valid E.164 phone number', async () => {
      await expect(makeProvider().ensurePhoneIsAllowed('+12025550123')).resolves.toBeUndefined();
    });

    it('throws 400 when the phone number is not in E.164 format', async () => {
      await expect(makeProvider().ensurePhoneIsAllowed('not-a-phone')).rejects.toMatchObject({
        statusCode: 400,
        details: { value: 'invalid E.164 format' },
      });
    });
  });
});
