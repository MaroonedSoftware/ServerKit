import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(),
    decode: vi.fn(),
    verify: vi.fn(),
  },
}));

import jsonwebtoken from 'jsonwebtoken';
import { JwtProvider } from '../../src/providers/jwt.provider.js';
import type { Logger } from '@maroonedsoftware/logger';
import { Duration } from 'luxon';

const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

describe('JwtProvider', () => {
  let logger: Logger;
  let provider: JwtProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    provider = new JwtProvider(logger, 'fake-pem-key');
  });

  describe('create', () => {
    it('calls jsonwebtoken.sign with RS256 algorithm and correct options', () => {
      vi.mocked(jsonwebtoken.sign).mockReturnValue('signed-token' as never);
      vi.mocked(jsonwebtoken.decode).mockReturnValue({ sub: 'user-1', exp: 3600 });

      provider.create({ claim: 'value' }, 'user-1', 'https://auth.example.com', 'https://api.example.com', Duration.fromObject({ hours: 1 }));

      expect(jsonwebtoken.sign).toHaveBeenCalledWith(
        { claim: 'value' },
        'fake-pem-key',
        expect.objectContaining({
          algorithm: 'RS256',
          issuer: 'https://auth.example.com',
          subject: 'user-1',
          audience: 'https://api.example.com',
        }),
      );
    });

    it('returns the token and decoded payload', () => {
      const decoded = { sub: 'user-1', exp: 3600 };
      vi.mocked(jsonwebtoken.sign).mockReturnValue('my-jwt' as never);
      vi.mocked(jsonwebtoken.decode).mockReturnValue(decoded);

      const result = provider.create({}, 'user-1', 'issuer', 'audience', Duration.fromObject({ hours: 1 }));

      expect(result.token).toBe('my-jwt');
      expect(result.decoded).toBe(decoded);
    });

    it('throws an HTTP 500 error when sign throws', () => {
      vi.mocked(jsonwebtoken.sign).mockImplementation(() => {
        throw new Error('signing failed');
      });

      expect(() => provider.create({}, 'user-1', 'issuer', 'audience', Duration.fromObject({ hours: 1 }))).toThrow();
    });

    it('throws an HTTP 500 error when decode returns null', () => {
      vi.mocked(jsonwebtoken.sign).mockReturnValue('my-jwt' as never);
      vi.mocked(jsonwebtoken.decode).mockReturnValue(null);

      expect(() => provider.create({}, 'user-1', 'issuer', 'audience', Duration.fromObject({ hours: 1 }))).toThrow();
    });
  });

  describe('decode', () => {
    it('calls jsonwebtoken.verify with the issuer', () => {
      vi.mocked(jsonwebtoken.verify).mockReturnValue({ sub: 'user-1' } as never);

      provider.decode('my-jwt', 'https://auth.example.com');

      expect(jsonwebtoken.verify).toHaveBeenCalledWith('my-jwt', 'fake-pem-key', expect.objectContaining({ issuer: 'https://auth.example.com' }));
    });

    it('returns the decoded payload on success', () => {
      const payload = { sub: 'user-1', iat: 1700000000 };
      vi.mocked(jsonwebtoken.verify).mockReturnValue(payload as never);

      const result = provider.decode('my-jwt', 'https://auth.example.com');

      expect(result).toBe(payload);
    });

    it('returns undefined and logs the error when verification fails', () => {
      vi.mocked(jsonwebtoken.verify).mockImplementation(() => {
        throw new Error('invalid signature');
      });

      const result = provider.decode('bad-jwt', 'issuer');

      expect(result).toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns undefined and logs when verify returns a string', () => {
      vi.mocked(jsonwebtoken.verify).mockReturnValue('unexpected-string' as never);

      const result = provider.decode('my-jwt', 'issuer');

      expect(result).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith('Unexpected string for jwt');
    });

    it('throws a 401 error when verification fails and reThrow is true', async () => {
      vi.mocked(jsonwebtoken.verify).mockImplementation(() => {
        throw new Error('expired');
      });

      expect(() => provider.decode('bad-jwt', 'issuer', false, true)).toThrow();
    });

    it('throws a 401 error when verify returns a string and reThrow is true', () => {
      vi.mocked(jsonwebtoken.verify).mockReturnValue('unexpected' as never);

      expect(() => provider.decode('my-jwt', 'issuer', false, true)).toThrow();
    });

    it('passes ignoreExpiration to jsonwebtoken.verify', () => {
      vi.mocked(jsonwebtoken.verify).mockReturnValue({ sub: 'user-1' } as never);

      provider.decode('my-jwt', 'issuer', true);

      expect(jsonwebtoken.verify).toHaveBeenCalledWith('my-jwt', 'fake-pem-key', expect.objectContaining({ ignoreExpiration: true }));
    });
  });
});
