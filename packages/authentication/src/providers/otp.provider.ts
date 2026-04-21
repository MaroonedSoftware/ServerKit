import * as crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { base32Decode, base32Encode } from '@maroonedsoftware/utilities';

export type OtpType = 'hotp' | 'totp';

export type OtpOptions = {
  type: OtpType;
  algorithm: string;
  counter?: number;
  periodSeconds?: number;
  tokenLength: number;
};

export type HotpOptions = OtpOptions & {
  type: 'hotp';
  counter: number;
};

export type TotpOptions = OtpOptions & {
  type: 'totp';
  periodSeconds: number;
  timestamp?: DateTime;
};

export const defaultOtpOptions: Required<OtpOptions> = {
  type: 'totp',
  algorithm: 'SHA1',
  counter: 0,
  periodSeconds: 30,
  tokenLength: 6,
} as const;

export type OtpUrlOptions = { label?: string; issuer: string };

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
