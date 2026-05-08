import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OtpProviderMock } from '../../src/providers/otp.provider.mock.js';
import type { Logger } from '@maroonedsoftware/logger';

const makeLogger = () =>
  ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }) as unknown as Logger;

describe('OtpProviderMock', () => {
  let logger: ReturnType<typeof makeLogger>;
  let provider: OtpProviderMock;

  beforeEach(() => {
    logger = makeLogger();
    provider = new OtpProviderMock(logger);
  });

  describe('generate', () => {
    it("returns the fixed code '000000' regardless of inputs", () => {
      expect(provider.generate('any-secret', { type: 'totp', periodSeconds: 30, tokenLength: 6 })).toBe('000000');
      expect(provider.generate('other-secret', { type: 'hotp', counter: 99 })).toBe('000000');
    });

    it('logs a warning on each call', () => {
      provider.generate('secret', { type: 'totp', periodSeconds: 30, tokenLength: 6 });
      expect(logger.warn).toHaveBeenCalledWith('Using mock OTP provider, remove this provider before production');
    });
  });

  describe('validate', () => {
    it('returns true regardless of inputs', () => {
      expect(provider.validate('wrong', 'secret', { type: 'totp', periodSeconds: 30, tokenLength: 6 })).toBe(true);
      expect(provider.validate('', '', { type: 'hotp', counter: 0 })).toBe(true);
    });

    it('logs a warning on each call', () => {
      provider.validate('otp', 'secret', { type: 'totp', periodSeconds: 30, tokenLength: 6 });
      expect(logger.warn).toHaveBeenCalledWith('Using mock OTP provider, remove this provider before production');
    });
  });
});
