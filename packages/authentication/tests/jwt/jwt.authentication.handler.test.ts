import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JwtAuthenticationHandler, JwtAuthenticationIssuerMap } from '../../src/jwt/jwt.authentication.handler.js';
import { invalidAuthenticationContext } from '../../src/authentication.context.js';
import type { AuthenticationContext } from '../../src/authentication.context.js';
import type { JwtAuthenticationIssuer } from '../../src/jwt/jwt.autentication.issuer.js';
import type { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';

vi.mock('jsonwebtoken', () => ({
  default: { decode: vi.fn() },
}));

import jsonwebtoken from 'jsonwebtoken';

const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

const makeValidContext = (): AuthenticationContext => ({
  actorId: 'auth-123',
  actorType: 'user',
  issuedAt: DateTime.now(),
  lastAccessedAt: DateTime.now(),
  expiresAt: DateTime.now().plus({ hours: 1 }),
  factors: [],
  claims: { sub: 'user-1' },
  roles: [],
});

describe('JwtAuthenticationHandler', () => {
  let issuerMap: JwtAuthenticationIssuerMap;
  let logger: Logger;
  let handler: JwtAuthenticationHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    issuerMap = new JwtAuthenticationIssuerMap();
    logger = makeLogger();
    handler = new JwtAuthenticationHandler(issuerMap, logger);
  });

  describe('authenticate', () => {
    it('returns invalidAuthenticationContext when scheme is not bearer', async () => {
      const result = await handler.authenticate('basic', 'dXNlcjpwYXNz');
      expect(result).toBe(invalidAuthenticationContext);
    });

    it('does not call jsonwebtoken.decode when scheme is not bearer', async () => {
      await handler.authenticate('basic', 'dXNlcjpwYXNz');
      expect(jsonwebtoken.decode).not.toHaveBeenCalled();
    });

    it('returns invalidAuthenticationContext when JWT cannot be decoded', async () => {
      vi.mocked(jsonwebtoken.decode).mockReturnValue(null);

      const result = await handler.authenticate('bearer', 'not.a.jwt');
      expect(result).toBe(invalidAuthenticationContext);
    });

    it('returns invalidAuthenticationContext and logs warning when no issuer is registered for the JWT iss', async () => {
      vi.mocked(jsonwebtoken.decode).mockReturnValue({ iss: 'https://auth.example.com', sub: 'user-1' });

      const result = await handler.authenticate('bearer', 'valid.jwt.token');

      expect(result).toBe(invalidAuthenticationContext);
      expect(logger.warn).toHaveBeenCalledWith('No JwtAuthenticationIssuer found for issuer', {
        issuer: 'https://auth.example.com',
      });
    });

    it('returns invalidAuthenticationContext and logs warning when JWT has no iss', async () => {
      vi.mocked(jsonwebtoken.decode).mockReturnValue({ sub: 'user-1' });

      const result = await handler.authenticate('bearer', 'valid.jwt.token');

      expect(result).toBe(invalidAuthenticationContext);
      expect(logger.warn).toHaveBeenCalledWith('No JwtAuthenticationIssuer found for issuer', {
        issuer: undefined,
      });
    });

    it('calls issuer.parse() with the decoded payload and returns its result', async () => {
      const payload = { iss: 'https://auth.example.com', sub: 'user-1' };
      const validContext = makeValidContext();
      const issuer: JwtAuthenticationIssuer = { parse: vi.fn().mockResolvedValue(validContext) };

      vi.mocked(jsonwebtoken.decode).mockReturnValue(payload);
      issuerMap.set('https://auth.example.com', issuer);

      const result = await handler.authenticate('bearer', 'valid.jwt.token');

      expect(issuer.parse).toHaveBeenCalledWith(payload);
      expect(result).toBe(validContext);
    });

    it('calls the correct issuer when multiple issuers are registered', async () => {
      const payload = { iss: 'https://issuer-b.example.com', sub: 'user-2' };
      const contextB = makeValidContext();
      const issuerA: JwtAuthenticationIssuer = { parse: vi.fn() };
      const issuerB: JwtAuthenticationIssuer = { parse: vi.fn().mockResolvedValue(contextB) };

      vi.mocked(jsonwebtoken.decode).mockReturnValue(payload);
      issuerMap.set('https://issuer-a.example.com', issuerA);
      issuerMap.set('https://issuer-b.example.com', issuerB);

      const result = await handler.authenticate('bearer', 'valid.jwt.token');

      expect(issuerA.parse).not.toHaveBeenCalled();
      expect(issuerB.parse).toHaveBeenCalledWith(payload);
      expect(result).toBe(contextB);
    });

    it('calls jsonwebtoken.decode with json:true option', async () => {
      vi.mocked(jsonwebtoken.decode).mockReturnValue(null);

      await handler.authenticate('bearer', 'some.jwt.token');

      expect(jsonwebtoken.decode).toHaveBeenCalledWith('some.jwt.token', { json: true });
    });
  });
});
