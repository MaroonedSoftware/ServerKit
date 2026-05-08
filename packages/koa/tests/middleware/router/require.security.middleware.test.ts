import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireSecurity } from '../../../src/middleware/router/require.security.middleware.js';
import {
  invalidAuthenticationSession,
  type AuthenticationFactorKind,
  type AuthenticationFactorMethod,
  type AuthenticationSession,
  type AuthenticationSessionFactor,
} from '@maroonedsoftware/authentication';
import { HttpError } from '@maroonedsoftware/errors';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';

const makeFactor = (kind: AuthenticationFactorKind, method: AuthenticationFactorMethod): AuthenticationSessionFactor =>
  ({ kind, method, methodId: `${method}-1` }) as unknown as AuthenticationSessionFactor;

const makeValidSession = (factors: AuthenticationSessionFactor[] = []): AuthenticationSession =>
  ({ subject: 'user-1', sessionToken: 'session-token-123', factors, claims: { sub: 'user-1' } }) as unknown as AuthenticationSession;

describe('requireSecurity', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNext = vi.fn().mockResolvedValue(undefined);
    mockCtx = {
      authenticationSession: invalidAuthenticationSession,
    } as unknown as ServerKitContext;
  });

  it('returns a middleware function', () => {
    const middleware = requireSecurity();
    expect(middleware).toBeTypeOf('function');
  });

  describe('when authenticationSession is invalid', () => {
    it('throws a 401 error', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationSession = invalidAuthenticationSession;

      await expect(middleware(mockCtx, mockNext)).rejects.toThrow(HttpError);

      try {
        await middleware(mockCtx, mockNext);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).statusCode).toBe(401);
      }
    });

    it('includes WWW-Authenticate header in the 401 error', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationSession = invalidAuthenticationSession;

      try {
        await middleware(mockCtx, mockNext);
      } catch (error) {
        expect((error as HttpError).headers?.['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
      }
    });

    it('does not call next()', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationSession = invalidAuthenticationSession;

      await expect(middleware(mockCtx, mockNext)).rejects.toThrow();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('when authenticationSession is valid', () => {
    it('calls next() when MFA is satisfied (knowledge + possession)', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationSession = makeValidSession([
        makeFactor('knowledge', 'password'),
        makeFactor('possession', 'authenticator'),
      ]);

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('calls next() when MFA is satisfied (knowledge + biometric)', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationSession = makeValidSession([
        makeFactor('knowledge', 'password'),
        makeFactor('biometric', 'fido'),
      ]);

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('calls next() when requireMfa is false and no factors are present', async () => {
      const middleware = requireSecurity({ requireMfa: false });
      mockCtx.authenticationSession = makeValidSession();

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });
  });

  describe('when MFA is required but not satisfied', () => {
    it('throws a 401 with mfa_required when session has no factors', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationSession = makeValidSession();

      try {
        await middleware(mockCtx, mockNext);
        expect.fail('Expected middleware to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).statusCode).toBe(401);
        expect((error as HttpError).headers?.['WWW-Authenticate']).toBe('Bearer error="mfa_required"');
      }
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('throws a 401 with mfa_required when session has only one factor', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationSession = makeValidSession([makeFactor('possession', 'authenticator')]);

      await expect(middleware(mockCtx, mockNext)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="mfa_required"' },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('throws a 401 with mfa_required when all factors are knowledge', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationSession = makeValidSession([
        makeFactor('knowledge', 'password'),
        makeFactor('knowledge', 'email'),
      ]);

      await expect(middleware(mockCtx, mockNext)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="mfa_required"' },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
