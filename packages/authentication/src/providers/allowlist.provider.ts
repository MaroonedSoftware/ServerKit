import { httpError } from '@maroonedsoftware/errors';
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
   * Ensure an email address is well-formed and not on the configured deny list.
   *
   * The email is expected to already be normalised (trimmed and lower-cased) by
   * the caller — domain matching against `emailDomainDenyList` is case-sensitive.
   *
   * @param value - The email address to check.
   * @throws HTTP 400 when `value` is not a valid email address or its domain is on the deny list.
   */
  async ensureEmailIsAllowed(value: string): Promise<void> {
    if (!isEmail(value)) {
      throw httpError(400).withDetails({ value: 'invalid email format' });
    }

    const domain = value.split('@')[1]!;

    if (binarySearch(this.options.emailDomainDenyList, domain)) {
      throw httpError(400).withDetails({ email: 'Must not be a disposable email' });
    }
  }

  /**
   * Ensure a phone number is in E.164 format.
   *
   * @param phone - The phone number to check (e.g. `+12025550123`).
   * @throws HTTP 400 when `phone` is not in valid E.164 format.
   */
  async ensurePhoneIsAllowed(phone: string): Promise<void> {
    if (!isPhoneE164(phone)) {
      throw httpError(400).withDetails({ value: 'invalid E.164 format' });
    }
  }
}
