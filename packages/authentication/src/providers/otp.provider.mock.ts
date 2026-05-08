import { Injectable } from 'injectkit';
import { HotpOptions, OtpProvider, TotpOptions } from './otp.provider.js';
import { Logger } from '@maroonedsoftware/logger';

const FIXED_CODE = '000000';

/**
 * Drop-in replacement for {@link OtpProvider} that bypasses real HOTP/TOTP
 * generation: every code is `'000000'` and every validation succeeds.
 *
 * Intended for local development, integration tests, and seeded environments
 * where the operator can't (or doesn't want to) deal with real codes — e.g.
 * smoke-testing the email/phone factor flows end-to-end without an inbox.
 *
 * Each call logs a `WARN` to the injected {@link Logger} so the mock is
 * impossible to leave running in production unnoticed. **Never register this
 * in a production container.**
 */
@Injectable()
export class OtpProviderMock extends OtpProvider {
  constructor(private readonly logger: Logger) {
    super();
  }

  /**
   * Always returns the fixed code `'000000'` and logs a warning.
   *
   * @returns The string `'000000'`.
   */
  override generate(_secret: string, _options: Partial<HotpOptions | TotpOptions>): string {
    this.logger.warn('Using mock OTP provider, remove this provider before production');
    return FIXED_CODE;
  }

  /**
   * Always returns `true` and logs a warning.
   *
   * @returns `true` for every input.
   */
  override validate(_otp: string, _secret: string, _options: Partial<HotpOptions | TotpOptions>, _window?: number): boolean {
    this.logger.warn('Using mock OTP provider, remove this provider before production');
    return true;
  }
}
