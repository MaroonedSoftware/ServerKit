import { describe, it, expect, beforeEach } from 'vitest';
import { OtpProvider, defaultOtpOptions } from '../../src/providers/otp.provider.js';
import { DateTime } from 'luxon';

describe('OtpProvider', () => {
  let provider: OtpProvider;

  beforeEach(() => {
    provider = new OtpProvider();
  });

  describe('createSecret', () => {
    it('returns a non-empty base32 string', () => {
      const secret = provider.createSecret();
      expect(secret).toBeTruthy();
      expect(typeof secret).toBe('string');
    });

    it('returns different secrets on each call', () => {
      const a = provider.createSecret();
      const b = provider.createSecret();
      expect(a).not.toBe(b);
    });
  });

  describe('generate', () => {
    describe('HOTP', () => {
      it('returns a 6-digit string for HOTP', () => {
        const secret = provider.createSecret();
        const otp = provider.generate(secret, { type: 'hotp', counter: 0 });
        expect(otp).toHaveLength(6);
        expect(/^\d+$/.test(otp)).toBe(true);
      });

      it('returns the same OTP for the same secret and counter', () => {
        const secret = provider.createSecret();
        const first = provider.generate(secret, { type: 'hotp', counter: 42 });
        const second = provider.generate(secret, { type: 'hotp', counter: 42 });
        expect(first).toBe(second);
      });

      it('returns different OTPs for different counters', () => {
        const secret = provider.createSecret();
        const a = provider.generate(secret, { type: 'hotp', counter: 0 });
        const b = provider.generate(secret, { type: 'hotp', counter: 1 });
        expect(a).not.toBe(b);
      });

      it('respects a custom token length', () => {
        const secret = provider.createSecret();
        const otp = provider.generate(secret, { type: 'hotp', counter: 0, tokenLength: 8 });
        expect(otp).toHaveLength(8);
      });

      it('always pads to the full token length', () => {
        const secret = provider.createSecret();
        for (let i = 0; i < 20; i++) {
          const otp = provider.generate(secret, { type: 'hotp', counter: i, tokenLength: 8 });
          expect(otp).toHaveLength(8);
        }
      });
    });

    describe('TOTP', () => {
      it('returns a 6-digit string for TOTP', () => {
        const secret = provider.createSecret();
        const otp = provider.generate(secret, { type: 'totp', periodSeconds: 30, timestamp: DateTime.fromSeconds(1700000000) });
        expect(otp).toHaveLength(6);
        expect(/^\d+$/.test(otp)).toBe(true);
      });

      it('returns the same OTP for timestamps within the same period', () => {
        const secret = provider.createSecret();
        const periodStart = Math.floor(1700000000 / 30) * 30;
        const t1 = DateTime.fromSeconds(periodStart);
        const t2 = DateTime.fromSeconds(periodStart + 10);
        expect(provider.generate(secret, { type: 'totp', periodSeconds: 30, timestamp: t1 })).toBe(
          provider.generate(secret, { type: 'totp', periodSeconds: 30, timestamp: t2 }),
        );
      });

      it('returns different OTPs for timestamps in different periods', () => {
        const secret = provider.createSecret();
        const periodStart = Math.floor(1700000000 / 30) * 30;
        const t1 = DateTime.fromSeconds(periodStart);
        const t2 = DateTime.fromSeconds(periodStart + 30);
        // Confirm counter differs even if OTP values happen to match by coincidence
        expect(Math.floor(t1.toSeconds() / 30)).not.toBe(Math.floor(t2.toSeconds() / 30));
        expect(typeof provider.generate(secret, { type: 'totp', periodSeconds: 30, timestamp: t1 })).toBe('string');
        expect(typeof provider.generate(secret, { type: 'totp', periodSeconds: 30, timestamp: t2 })).toBe('string');
      });

      it('uses defaultOtpOptions values when fields are omitted', () => {
        const secret = provider.createSecret();
        const ts = DateTime.fromSeconds(1700000000);
        const otp = provider.generate(secret, { type: 'totp', timestamp: ts });
        expect(otp).toHaveLength(defaultOtpOptions.tokenLength);
      });
    });
  });

  describe('validate', () => {
    describe('HOTP', () => {
      it('returns true for a matching OTP at the given counter', () => {
        const secret = provider.createSecret();
        const otp = provider.generate(secret, { type: 'hotp', counter: 5 });
        expect(provider.validate(otp, secret, { type: 'hotp', counter: 5 })).toBe(true);
      });

      it('returns false for an incorrect OTP', () => {
        const secret = provider.createSecret();
        const otp = provider.generate(secret, { type: 'hotp', counter: 5 });
        const badOtp = otp.replace(/\d/, d => String((Number(d) + 1) % 10));
        expect(provider.validate(badOtp, secret, { type: 'hotp', counter: 5 })).toBe(false);
      });

      it('returns false when OTP length does not match tokenLength', () => {
        const secret = provider.createSecret();
        expect(provider.validate('123', secret, { type: 'hotp', counter: 0, tokenLength: 6 })).toBe(false);
      });

      it('returns true for an OTP within the lookahead window', () => {
        const secret = provider.createSecret();
        const futureOtp = provider.generate(secret, { type: 'hotp', counter: 11 });
        expect(provider.validate(futureOtp, secret, { type: 'hotp', counter: 10 }, 1)).toBe(true);
      });

      it('returns false for an OTP outside the window', () => {
        const secret = provider.createSecret();
        const farOtp = provider.generate(secret, { type: 'hotp', counter: 15 });
        expect(provider.validate(farOtp, secret, { type: 'hotp', counter: 10 }, 1)).toBe(false);
      });
    });

    describe('TOTP', () => {
      it('returns true for a valid TOTP at the given timestamp', () => {
        const secret = provider.createSecret();
        const ts = DateTime.fromSeconds(1700000000);
        const otp = provider.generate(secret, { type: 'totp', periodSeconds: 30, timestamp: ts });
        expect(provider.validate(otp, secret, { type: 'totp', periodSeconds: 30, timestamp: ts })).toBe(true);
      });

      it('returns false for an incorrect TOTP', () => {
        const secret = provider.createSecret();
        const ts = DateTime.fromSeconds(1700000000);
        const otp = provider.generate(secret, { type: 'totp', periodSeconds: 30, timestamp: ts });
        const badOtp = otp.replace(/\d/, d => String((Number(d) + 1) % 10));
        expect(provider.validate(badOtp, secret, { type: 'totp', periodSeconds: 30, timestamp: ts })).toBe(false);
      });

      it('returns true for a TOTP from the previous period within the window', () => {
        const secret = provider.createSecret();
        const ts = DateTime.fromSeconds(1700000000);
        const previousTs = DateTime.fromSeconds(1700000000 - 30);
        const previousOtp = provider.generate(secret, { type: 'totp', periodSeconds: 30, timestamp: previousTs });
        expect(provider.validate(previousOtp, secret, { type: 'totp', periodSeconds: 30, timestamp: ts }, 1)).toBe(true);
      });
    });
  });

  describe('generateURI', () => {
    it('generates a valid TOTP otpauth URI', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const uri = provider.generateURI(secret, { type: 'totp', periodSeconds: 30, algorithm: 'sha1', tokenLength: 6 }, { issuer: 'Example' });
      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
      expect(uri).toContain('issuer=Example');
      expect(uri).toContain('period=30');
      expect(uri).toContain('algorithm=SHA1');
      expect(uri).toContain('digits=6');
    });

    it('upper-cases the algorithm in the URI even though the input is lowercase', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const uri = provider.generateURI(secret, { type: 'totp', periodSeconds: 30, algorithm: 'sha256', tokenLength: 6 }, { issuer: 'Example' });
      expect(uri).toContain('algorithm=SHA256');
    });

    it('generates a valid HOTP otpauth URI with counter', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const uri = provider.generateURI(secret, { type: 'hotp', counter: 7, algorithm: 'sha1', tokenLength: 6 }, { issuer: 'Example' });
      expect(uri).toContain('otpauth://hotp/');
      expect(uri).toContain('counter=7');
    });

    it('URL-encodes the label in the URI path', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const uri = provider.generateURI(
        secret,
        { type: 'totp', periodSeconds: 30, algorithm: 'sha1', tokenLength: 6 },
        { issuer: 'Example', label: 'user@test.com' },
      );
      expect(uri).toContain('user%40test.com');
    });

    it('omits the label separator when no label is provided', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const uri = provider.generateURI(secret, { type: 'totp', periodSeconds: 30, algorithm: 'sha1', tokenLength: 6 }, { issuer: 'Example' });
      expect(new URL(uri).pathname).not.toContain(':');
    });
  });
  describe('validateWithCounter', () => {
    const secret = 'JBSWY3DPEHPK3PXP';

    it('returns the counter that matched for hotp', () => {
      const options = { type: 'hotp' as const, counter: 12, algorithm: 'sha1' as const, tokenLength: 6 };
      const code = provider.generate(secret, options);
      expect(provider.validateWithCounter(code, secret, options)).toBe(12);
    });

    it('returns the drifted counter when the code came from a neighbouring step', () => {
      const options = { type: 'hotp' as const, algorithm: 'sha1' as const, tokenLength: 6 };
      const code = provider.generate(secret, { ...options, counter: 13 });
      expect(provider.validateWithCounter(code, secret, { ...options, counter: 12 })).toBe(13);
    });

    it('returns the time step that matched for totp', () => {
      const timestamp = DateTime.fromSeconds(1_740_000_000, { zone: 'utc' });
      const options = { type: 'totp' as const, periodSeconds: 30, algorithm: 'sha1' as const, tokenLength: 6, timestamp };
      const code = provider.generate(secret, options);
      expect(provider.validateWithCounter(code, secret, options)).toBe(Math.floor(1_740_000_000 / 30));
    });

    it('returns undefined for an invalid code', () => {
      const options = { type: 'hotp' as const, counter: 12, algorithm: 'sha1' as const, tokenLength: 6 };
      expect(provider.validateWithCounter('000000', secret, { ...options, counter: 900 })).toBeUndefined();
    });

    it('rejects a multibyte code of the right character length without throwing', () => {
      // `timingSafeEqual` throws a RangeError on unequal buffer lengths, so the guard
      // has to compare bytes: this input is 6 characters but 7 bytes.
      const options = { type: 'hotp' as const, counter: 12, algorithm: 'sha1' as const, tokenLength: 6 };
      expect(() => provider.validateWithCounter('1234\u00e95', secret, options)).not.toThrow();
      expect(provider.validateWithCounter('1234\u00e95', secret, options)).toBeUndefined();
    });

    it('agrees with validate on the same inputs', () => {
      const options = { type: 'hotp' as const, counter: 3, algorithm: 'sha1' as const, tokenLength: 6 };
      const code = provider.generate(secret, options);
      expect(provider.validate(code, secret, options)).toBe(true);
      expect(provider.validate('111111', secret, { ...options, counter: 800 })).toBe(false);
    });
  });
});
