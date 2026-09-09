import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { defaultOtpOptions, HotpOptions, OtpProvider, TotpOptions } from './otp.provider.js';
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

  /**
   * Always succeeds, reporting the step the caller is already on: the stored
   * `counter` for HOTP, the current time step for TOTP. `AuthenticatorFactorService`
   * uses the returned step to advance the counter and to mark the code consumed, so
   * the mock has to answer here as well as in {@link validate}.
   *
   * @returns The current counter or time step; never `undefined`.
   */
  override validateWithCounter(_otp: string, _secret: string, options: Partial<HotpOptions | TotpOptions>, _window?: number): number {
    this.logger.warn('Using mock OTP provider, remove this provider before production');
    if (options.type === 'hotp') {
      return options.counter ?? 0;
    }
    const periodSeconds = options.periodSeconds ?? defaultOtpOptions.periodSeconds;
    const timestamp = (options as Partial<TotpOptions>).timestamp ?? DateTime.utc();
    return Math.floor(timestamp.toSeconds() / periodSeconds);
  }
}
