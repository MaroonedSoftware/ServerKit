import * as crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { base32Decode, base32Encode } from '@maroonedsoftware/utilities';

/** Discriminator for which OTP scheme to use: counter-based (HOTP, RFC 4226) or time-based (TOTP, RFC 6238). */
export type OtpType = 'hotp' | 'totp';

/** Shared options for HOTP/TOTP generation and validation; specialised by {@link HotpOptions} and {@link TotpOptions}. */
export type OtpOptions = {
  type: OtpType;
  /**
   * HMAC algorithm used to derive the code. Must be lowercase (`'sha1'`, `'sha256'`, or `'sha512'`);
   * {@link OtpProvider.generateURI} upper-cases it when serialising to the `otpauth://` URI per the
   * Key Uri Format spec (RFC 4226 / RFC 6238).
   */
  algorithm: 'sha1' | 'sha256' | 'sha512';
  counter?: number;
  periodSeconds?: number;
  tokenLength: number;
};

/** HOTP-specific options: `type` narrowed to `'hotp'` and `counter` required. */
export type HotpOptions = OtpOptions & {
  type: 'hotp';
  counter: number;
};

/** TOTP-specific options: `type` narrowed to `'totp'`, `periodSeconds` required, with an optional explicit `timestamp`. */
export type TotpOptions = OtpOptions & {
  type: 'totp';
  periodSeconds: number;
  timestamp?: DateTime;
};

/** Default OTP options used as the base when merging caller-supplied partial options: TOTP / SHA-1 / 30s / 6 digits. */
export const defaultOtpOptions: Required<OtpOptions> = {
  type: 'totp',
  algorithm: 'sha1',
  counter: 0,
  periodSeconds: 30,
  tokenLength: 6,
} as const;

/** Metadata used when building an `otpauth://` provisioning URI: required `issuer` and optional account `label`. */
export type OtpUrlOptions = { label?: string; issuer: string };

/** Options controlling OTP validation, currently the counter/period drift `window`. */
export type OtpValidationOptions = {
  window: number;
};

function isHotpOptions(options: OtpOptions): options is HotpOptions {
  return options.type === 'hotp';
}

function isTotpOptions(options: OtpOptions): options is TotpOptions {
  return options.type === 'totp';
}

/**
 * Generates and validates HOTP and TOTP one-time passwords as defined in
 * RFC 4226 and RFC 6238 respectively, plus `otpauth://` URI generation for
 * QR code provisioning.
 */
@Injectable()
export class OtpProvider {
  private uintDecode(num: number) {
    const buf = new ArrayBuffer(8);
    const arr = new Uint8Array(buf);
    let acc = num;

    for (let i = 7; i >= 0; i--) {
      if (acc === 0) break;
      arr[i] = acc & 255;
      acc -= arr[i]!;
      acc /= 256;
    }

    return arr;
  }

  /**
   * Generate a cryptographically random base32-encoded secret for use with HOTP/TOTP.
   * @param numBytes - Number of random bytes before encoding (default `32`).
   */
  createSecret(numBytes: number = 32) {
    return base32Encode(crypto.randomBytes(numBytes), false);
  }

  /**
   * Generate an HOTP or TOTP one-time password.
   *
   * @param secret  - Base32-encoded secret (from {@link createSecret}).
   * @param options - OTP options; missing fields fall back to {@link defaultOtpOptions}.
   * @returns The generated OTP string, zero-padded to `tokenLength` digits.
   */
  generate(secret: string, options: Partial<HotpOptions | TotpOptions>) {
    const otpOptions = { ...defaultOtpOptions, ...options };

    const { counter, tokenLength, algorithm, periodSeconds } = otpOptions;

    if (isHotpOptions(otpOptions)) {
      return this.generateHOTP(secret, counter, tokenLength, algorithm);
    } else if (isTotpOptions(otpOptions)) {
      return this.generateTOTP(secret, otpOptions.timestamp ?? DateTime.utc(), periodSeconds, tokenLength, algorithm);
    } else {
      return '';
    }
  }

  private generateHOTP(secret: string, counter: number, tokenLength: number, algorithm: string) {
    const hmac = crypto.createHmac(algorithm, base32Decode(secret));
    hmac.update(this.uintDecode(counter));
    const digest = hmac.digest();

    const offset = digest[digest.byteLength - 1]! & 15;
    const otp =
      (((digest[offset]! & 127) << 24) | ((digest[offset + 1]! & 255) << 16) | ((digest[offset + 2]! & 255) << 8) | (digest[offset + 3]! & 255)) %
      10 ** tokenLength;

    return otp.toString().padStart(tokenLength, '0');
  }

  private generateTOTP(secret: string, timestamp: DateTime, periodSeconds: number, tokenLength: number, algorithm: string) {
    const counter = Math.floor(timestamp.toSeconds() / periodSeconds);

    return this.generateHOTP(secret, counter, tokenLength, algorithm);
  }

  /**
   * Validate an HOTP or TOTP one-time password.
   *
   * Accepts codes within `±window` counter steps (HOTP) or time periods (TOTP) to
   * account for clock drift or counter desync.
   *
   * @param otp     - The code submitted by the user.
   * @param secret  - Base32-encoded secret.
   * @param options - OTP options used when the code was generated.
   * @param window  - Number of steps either side of the current counter/period to accept (default `1`).
   * @returns `true` when the OTP is valid, `false` otherwise.
   */
  validate(otp: string, secret: string, options: Partial<HotpOptions | TotpOptions>, window: number = 1) {
    const otpOptions = { ...defaultOtpOptions, ...options };

    if (isHotpOptions(otpOptions)) {
      return this.validateHOTP(otp, secret, otpOptions, window);
    } else if (isTotpOptions(otpOptions)) {
      return this.validateTOTP(otp, secret, otpOptions, window);
    }
  }

  private validateHOTP(otp: string, secret: string, options: HotpOptions, window: number = 1) {
    if (otp.length !== options.tokenLength) {
      return false;
    }
    const { tokenLength, algorithm, counter } = options;
    const check = (i: number) => {
      const generatedToken = this.generateHOTP(secret, i, tokenLength, algorithm);
      return crypto.timingSafeEqual(Buffer.from(otp), Buffer.from(generatedToken));
    };

    for (let i = 0; i <= window; ++i) {
      if (check(counter - i) || check(counter + i)) {
        return true;
      }
    }

    return false;
  }

  private validateTOTP(otp: string, secret: string, options: TotpOptions, window: number = 1) {
    const { timestamp, periodSeconds } = options;
    const counter = Math.floor((timestamp?.toSeconds() ?? DateTime.utc().toSeconds()) / periodSeconds);

    return this.validateHOTP(otp, secret, { ...options, type: 'hotp', counter }, window);
  }

  /**
   * Build an `otpauth://` provisioning URI suitable for encoding as a QR code.
   *
   * @param secret     - Base32-encoded secret.
   * @param options    - OTP algorithm options (type, algorithm, period/counter, token length).
   * @param urlOptions - URI metadata: `issuer` (required) and an optional `label` (e.g. user email).
   * @returns A fully-formed `otpauth://totp/...` or `otpauth://hotp/...` URI string.
   */
  generateURI(secret: string, options: OtpOptions, urlOptions: OtpUrlOptions) {
    const values: Record<string, string | number> = {
      issuer: urlOptions.issuer,
      secret,
      algorithm: options.algorithm.toUpperCase(),
      digits: options.tokenLength,
    };

    if (isHotpOptions(options)) {
      values.counter = options.counter;
    } else if (isTotpOptions(options)) {
      values.period = options.periodSeconds;
    }

    const queryString = Object.entries(values)
      .map(kvp => encodeURIComponent(kvp[0]) + '=' + encodeURIComponent(kvp[1]))
      .join('&');

    const label = urlOptions.label ? ':' + encodeURIComponent(urlOptions.label) : '';

    const url = new URL(`otpauth://${options.type}/${urlOptions.issuer}${label}?${queryString}`);

    return url.toString();
  }
}
