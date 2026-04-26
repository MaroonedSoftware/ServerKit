import { describe, it, expect, vi, beforeEach } from 'vitest';
import jsonwebtoken from 'jsonwebtoken';
import { JwtAuthenticationHandler, JwtAuthenticationIssuerMap } from '../../src/jwt/jwt.authentication.handler.js';
import { invalidAuthenticationContext } from '../../src/authentication.context.js';
import type { AuthenticationContext } from '../../src/authentication.context.js';
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
    issuerMap = new JwtAuthenticationIssuerMap();
    logger = makeLogger();
    handler = new JwtAuthenticationHandler(issuerMap, logger);
  });

  describe('authenticate', () => {
    it('returns invalidAuthenticationContext when scheme is not bearer', async () => {
      const token = signToken({ iss: 'https://auth.example.com', sub: 'user-1' });
      issuerMap.set('https://auth.example.com', { parse: vi.fn() });

      const result = await handler.authenticate('basic', token);

      expect(result).toBe(invalidAuthenticationContext);
    });

    it('does not consult any issuer when scheme is not bearer', async () => {
      const issuer: JwtAuthenticationIssuer = { parse: vi.fn() };
      issuerMap.set('https://auth.example.com', issuer);

      await handler.authenticate('basic', signToken({ iss: 'https://auth.example.com', sub: 'user-1' }));

      expect(issuer.parse).not.toHaveBeenCalled();
    });

    it('returns invalidAuthenticationContext for a malformed bearer token', async () => {
      const result = await handler.authenticate('bearer', 'not.a.jwt');
      expect(result).toBe(invalidAuthenticationContext);
    });

    it('returns invalidAuthenticationContext and logs when no issuer is registered for the JWT iss', async () => {
      const token = signToken({ iss: 'https://auth.example.com', sub: 'user-1' });

      const result = await handler.authenticate('bearer', token);

      expect(result).toBe(invalidAuthenticationContext);
      expect(logger.warn).toHaveBeenCalledWith('No JwtAuthenticationIssuer found for issuer', {
        issuer: 'https://auth.example.com',
      });
    });

    it('returns invalidAuthenticationContext and logs when JWT has no iss', async () => {
      const token = signToken({ sub: 'user-1' });

      const result = await handler.authenticate('bearer', token);

      expect(result).toBe(invalidAuthenticationContext);
      expect(logger.warn).toHaveBeenCalledWith('No JwtAuthenticationIssuer found for issuer', {
        issuer: undefined,
      });
    });

    it('passes the decoded payload to the matching issuer and returns its result', async () => {
      const token = signToken({ iss: 'https://auth.example.com', sub: 'user-1', custom: 'claim' });
      const validContext = makeValidContext();
      const issuer: JwtAuthenticationIssuer = { parse: vi.fn().mockResolvedValue(validContext) };
      issuerMap.set('https://auth.example.com', issuer);

      const result = await handler.authenticate('bearer', token);

      expect(issuer.parse).toHaveBeenCalledWith(
        expect.objectContaining({ iss: 'https://auth.example.com', sub: 'user-1', custom: 'claim' }),
      );
      expect(result).toBe(validContext);
    });

    it('routes to the issuer matching the iss claim when multiple are registered', async () => {
      const token = signToken({ iss: 'https://issuer-b.example.com', sub: 'user-2' });
      const contextB = makeValidContext();
      const issuerA: JwtAuthenticationIssuer = { parse: vi.fn() };
      const issuerB: JwtAuthenticationIssuer = { parse: vi.fn().mockResolvedValue(contextB) };
      issuerMap.set('https://issuer-a.example.com', issuerA);
      issuerMap.set('https://issuer-b.example.com', issuerB);

      const result = await handler.authenticate('bearer', token);

      expect(issuerA.parse).not.toHaveBeenCalled();
      expect(issuerB.parse).toHaveBeenCalledWith(expect.objectContaining({ iss: 'https://issuer-b.example.com' }));
      expect(result).toBe(contextB);
    });

    it('decodes a token without verifying its signature (delegation contract)', async () => {
      // The handler intentionally does not verify — that's the issuer's responsibility.
      // A token signed with a key the handler doesn't know should still reach the issuer.
      const foreignToken = jsonwebtoken.sign(
        { iss: 'https://auth.example.com', sub: 'user-1' },
        'completely-different-secret',
        { algorithm: 'HS256' },
      );
      const issuer: JwtAuthenticationIssuer = { parse: vi.fn().mockResolvedValue(makeValidContext()) };
      issuerMap.set('https://auth.example.com', issuer);

      await handler.authenticate('bearer', foreignToken);

      expect(issuer.parse).toHaveBeenCalled();
    });
  });
});
