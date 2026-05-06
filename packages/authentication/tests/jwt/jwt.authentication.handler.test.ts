import { describe, it, expect, vi, beforeEach } from 'vitest';
import jsonwebtoken from 'jsonwebtoken';
import { JwtAuthenticationHandler, JwtAuthenticationIssuerMap } from '../../src/jwt/jwt.authentication.handler.js';
import { invalidAuthenticationSession } from '../../src/types.js';
import type { AuthenticationSession } from '../../src/types.js';
import type { JwtAuthenticationIssuer } from '../../src/jwt/jwt.autentication.issuer.js';
import type { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';

const SECRET = 'test-secret-for-handler-decode-only';

const signToken = (payload: Record<string, unknown>) =>
  jsonwebtoken.sign(payload, SECRET, { algorithm: 'HS256' });

const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

const makeValidSession = (): AuthenticationSession => ({
  subject: 'user-1',
  sessionToken: 'session-token-123',
  issuedAt: DateTime.now(),
  lastAccessedAt: DateTime.now(),
  expiresAt: DateTime.now().plus({ hours: 1 }),
  factors: [],
  claims: { sub: 'user-1' },
});

describe('JwtAuthenticationHandler', () => {
  let issuerMap: JwtAuthenticationIssuerMap;
  let logger: Logger;
  let handler: JwtAuthenticationHandler;

  beforeEach(() => {
    issuerMap = new JwtAuthenticationIssuerMap();
    logger = makeLogger();
    handler = new JwtAuthenticationHandler(issuerMap, logger);
  });

  describe('authenticate', () => {
    it('returns invalidAuthenticationSession when scheme is not bearer', async () => {
      const token = signToken({ iss: 'https://auth.example.com', sub: 'user-1' });
      issuerMap.set('https://auth.example.com', { parse: vi.fn() });

      const result = await handler.authenticate('basic', token);

      expect(result).toBe(invalidAuthenticationSession);
    });

    it('does not consult any issuer when scheme is not bearer', async () => {
      const issuer: JwtAuthenticationIssuer = { parse: vi.fn() };
      issuerMap.set('https://auth.example.com', issuer);

      await handler.authenticate('basic', signToken({ iss: 'https://auth.example.com', sub: 'user-1' }));

      expect(issuer.parse).not.toHaveBeenCalled();
    });

    it('returns invalidAuthenticationSession for a malformed bearer token', async () => {
      const result = await handler.authenticate('bearer', 'not.a.jwt');
      expect(result).toBe(invalidAuthenticationSession);
    });

    it('returns invalidAuthenticationSession and logs when no issuer is registered for the JWT iss', async () => {
      const token = signToken({ iss: 'https://auth.example.com', sub: 'user-1' });

      const result = await handler.authenticate('bearer', token);

      expect(result).toBe(invalidAuthenticationSession);
      expect(logger.warn).toHaveBeenCalledWith('No JwtAuthenticationIssuer found for issuer', {
        issuer: 'https://auth.example.com',
      });
    });

    it('returns invalidAuthenticationSession and logs when JWT has no iss', async () => {
      const token = signToken({ sub: 'user-1' });

      const result = await handler.authenticate('bearer', token);

      expect(result).toBe(invalidAuthenticationSession);
      expect(logger.warn).toHaveBeenCalledWith('No JwtAuthenticationIssuer found for issuer', {
        issuer: undefined,
      });
    });

    it('passes the decoded payload to the matching issuer and returns its result', async () => {
      const token = signToken({ iss: 'https://auth.example.com', sub: 'user-1', custom: 'claim' });
      const validSession = makeValidSession();
      const issuer: JwtAuthenticationIssuer = { parse: vi.fn().mockResolvedValue(validSession) };
      issuerMap.set('https://auth.example.com', issuer);

      const result = await handler.authenticate('bearer', token);

      expect(issuer.parse).toHaveBeenCalledWith(
        expect.objectContaining({ iss: 'https://auth.example.com', sub: 'user-1', custom: 'claim' }),
      );
      expect(result).toBe(validSession);
    });

    it('routes to the issuer matching the iss claim when multiple are registered', async () => {
      const token = signToken({ iss: 'https://issuer-b.example.com', sub: 'user-2' });
      const sessionB = makeValidSession();
      const issuerA: JwtAuthenticationIssuer = { parse: vi.fn() };
      const issuerB: JwtAuthenticationIssuer = { parse: vi.fn().mockResolvedValue(sessionB) };
      issuerMap.set('https://issuer-a.example.com', issuerA);
      issuerMap.set('https://issuer-b.example.com', issuerB);

      const result = await handler.authenticate('bearer', token);

      expect(issuerA.parse).not.toHaveBeenCalled();
      expect(issuerB.parse).toHaveBeenCalledWith(expect.objectContaining({ iss: 'https://issuer-b.example.com' }));
      expect(result).toBe(sessionB);
    });

    it('decodes a token without verifying its signature (delegation contract)', async () => {
      // The handler intentionally does not verify — that's the issuer's responsibility.
      // A token signed with a key the handler doesn't know should still reach the issuer.
      const foreignToken = jsonwebtoken.sign(
        { iss: 'https://auth.example.com', sub: 'user-1' },
        'completely-different-secret',
        { algorithm: 'HS256' },
      );
      const issuer: JwtAuthenticationIssuer = { parse: vi.fn().mockResolvedValue(makeValidSession()) };
      issuerMap.set('https://auth.example.com', issuer);

      await handler.authenticate('bearer', foreignToken);

      expect(issuer.parse).toHaveBeenCalled();
    });
  });
});
