import { binarySearch, isEmail, isPhoneE164 } from '@maroonedsoftware/utilities';
import { Injectable } from 'injectkit';

/**
 * Configuration options for {@link AllowlistProvider}.
 */
@Injectable()
export class AllowlistProviderOptions {
  constructor(
    /** Domains to reject during email registration (e.g. disposable email providers). Checked via binary search — keep sorted. */
    public readonly emailDomainDenyList: string[] = [],
  ) {}
}

/**
 * Result of an allowlist check. `allowed` is `true` when the value passed all
 * checks; on a failed check `reason` carries a short machine-readable code
 * (`'invalid_format'`, `'deny_list'`, or a subclass-defined string) so the
 * caller can map it to a user-facing message.
 */
export type AllowListResult = {
  allowed: boolean;
  reason?: 'invalid_format' | 'deny_list' | string;
};

/**
 * Validates email addresses and phone numbers against format rules and
 * configured deny lists during factor registration.
 *
 * Centralising these checks keeps factor services free of policy: subclass or
 * replace this provider to plug in stricter rules (regional phone number
 * filtering, dynamic deny lists, MX record probing, etc.) without touching the
 * factor services themselves.
 */
@Injectable()
export class AllowlistProvider {
  constructor(private readonly options: AllowlistProviderOptions) {}

  /**
   * Check whether an email address is well-formed and not on the configured deny list.
   *
   * The email is expected to already be normalised (trimmed and lower-cased) by
   * the caller — domain matching against `emailDomainDenyList` is case-sensitive.
   *
   * @param value - The email address to check.
   * @returns `{ allowed: true }` on success; `{ allowed: false, reason }` with
   *   `reason` of `'invalid_format'` (malformed email) or `'deny_list'` (domain
   *   matched `emailDomainDenyList`) on failure.
   */
  async checkEmailIsAllowed(value: string): Promise<AllowListResult> {
    if (!isEmail(value)) {
      return { allowed: false, reason: 'invalid_format' };
    }

    const domain = value.split('@')[1]!;

    if (binarySearch(this.options.emailDomainDenyList, domain)) {
      return { allowed: false, reason: 'deny_list' };
    }

    return { allowed: true };
  }

  /**
   * Check whether a phone number is in E.164 format.
   *
   * @param phone - The phone number to check (e.g. `+12025550123`).
   * @returns `{ allowed: true }` on success; `{ allowed: false, reason: 'invalid_format' }` when not E.164.
   */
  async checkPhoneIsAllowed(phone: string): Promise<AllowListResult> {
    if (!isPhoneE164(phone)) {
      return { allowed: false, reason: 'invalid_format' };
    }

    return { allowed: true };
  }
}
