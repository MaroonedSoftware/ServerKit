import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
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

const generateRsaPem = () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
};

describe('JwtProvider', () => {
  let logger: Logger;
  let provider: JwtProvider;
  let pem: string;

  beforeEach(() => {
    logger = makeLogger();
    pem = generateRsaPem();
    provider = new JwtProvider(logger, pem);
  });

  describe('create', () => {
    it('signs an RS256 token whose claims round-trip through verify', () => {
      const { token, decoded } = provider.create(
        { role: 'admin' },
        'user-1',
        'https://auth.example.com',
        'https://api.example.com',
        Duration.fromObject({ hours: 1 }),
      );

      // The token's header advertises RS256 — guard against alg downgrade.
      const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'));
      expect(header.alg).toBe('RS256');

      // The decoded payload reflects the claims we passed in.
      expect(decoded).toMatchObject({
        role: 'admin',
        sub: 'user-1',
        iss: 'https://auth.example.com',
        aud: 'https://api.example.com',
      });
      expect(typeof (decoded as { exp: number }).exp).toBe('number');

      // An independent verify with the same key succeeds.
      const independentlyVerified = jsonwebtoken.verify(token, pem, { issuer: 'https://auth.example.com' });
      expect(independentlyVerified).toMatchObject({ role: 'admin', sub: 'user-1' });
    });

    it('embeds expiresIn as an exp claim relative to issuedAt', () => {
      const lifetime = Duration.fromObject({ minutes: 15 });
      const { decoded } = provider.create({}, 'user-1', 'iss', 'aud', lifetime);

      const { iat, exp } = decoded as { iat: number; exp: number };
      expect(exp - iat).toBe(lifetime.as('seconds'));
    });

    it('throws an HTTP 500 error when the signing key is malformed', () => {
      const broken = new JwtProvider(logger, 'not-a-real-pem-key');
      expect(() => broken.create({}, 'user-1', 'iss', 'aud', Duration.fromObject({ hours: 1 }))).toThrow();
    });
  });

  describe('decode', () => {
    const create = (overrides: { issuer?: string; expiresIn?: Duration; claims?: Record<string, unknown> } = {}) =>
      provider.create(
        overrides.claims ?? {},
        'user-1',
        overrides.issuer ?? 'https://auth.example.com',
        'https://api.example.com',
        overrides.expiresIn ?? Duration.fromObject({ hours: 1 }),
      ).token;

    it('verifies and returns the payload for a token signed by this provider', () => {
      const token = create({ claims: { role: 'admin' } });

      const result = provider.decode(token, 'https://auth.example.com');

      expect(result).toMatchObject({ role: 'admin', sub: 'user-1' });
    });

    it('returns undefined and logs when the issuer claim does not match', () => {
      const token = create({ issuer: 'https://other.example.com' });

      const result = provider.decode(token, 'https://auth.example.com');

      expect(result).toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns undefined and logs when the signature is tampered with', () => {
      const token = create();
      const [header, payload, signature] = token.split('.');
      const flipped = signature!.slice(0, -2) + (signature!.slice(-2) === 'AA' ? 'BB' : 'AA');
      const tampered = `${header}.${payload}.${flipped}`;

      const result = provider.decode(tampered, 'https://auth.example.com');

      expect(result).toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns undefined and logs when the token was signed by a different key', () => {
      const otherPem = generateRsaPem();
      const foreignToken = jsonwebtoken.sign({ sub: 'attacker' }, otherPem, {
        algorithm: 'RS256',
        issuer: 'https://auth.example.com',
        expiresIn: 3600,
      });

      const result = provider.decode(foreignToken, 'https://auth.example.com');

      expect(result).toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns undefined for an expired token by default', () => {
      const token = create({ expiresIn: Duration.fromObject({ seconds: -10 }) });

      const result = provider.decode(token, 'https://auth.example.com');

      expect(result).toBeUndefined();
    });

    it('decodes an expired token when ignoreExpiration is true', () => {
      const token = create({ expiresIn: Duration.fromObject({ seconds: -10 }), claims: { role: 'admin' } });

      const result = provider.decode(token, 'https://auth.example.com', true);

      expect(result).toMatchObject({ role: 'admin' });
    });

    it('throws HTTP 401 when verification fails and reThrow is true', () => {
      const otherPem = generateRsaPem();
      const foreignToken = jsonwebtoken.sign({ sub: 'attacker' }, otherPem, {
        algorithm: 'RS256',
        issuer: 'https://auth.example.com',
        expiresIn: 3600,
      });

      expect(() => provider.decode(foreignToken, 'https://auth.example.com', false, true)).toThrow();
    });

    it('throws HTTP 401 for an expired token when reThrow is true', () => {
      const token = create({ expiresIn: Duration.fromObject({ seconds: -10 }) });

      expect(() => provider.decode(token, 'https://auth.example.com', false, true)).toThrow();
    });

    it('rejects an HS256 token that mimics the issuer (alg confusion guard)', () => {
      const hsToken = jsonwebtoken.sign({ sub: 'attacker' }, 'shared-secret', {
        algorithm: 'HS256',
        issuer: 'https://auth.example.com',
        expiresIn: 3600,
      });

      const result = provider.decode(hsToken, 'https://auth.example.com');

      // jsonwebtoken's verify with a PEM key refuses the HS256 alg, so this must fail.
      expect(result).toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
