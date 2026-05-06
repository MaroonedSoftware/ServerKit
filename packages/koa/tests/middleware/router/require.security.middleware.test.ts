import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireSecurity } from '../../../src/middleware/router/require.security.middleware.js';
import { invalidAuthenticationSession, type AuthenticationSession } from '@maroonedsoftware/authentication';
import { HttpError } from '@maroonedsoftware/errors';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';

const makeValidSession = (): AuthenticationSession =>
  ({ subject: 'user-1', sessionToken: 'session-token-123', factors: [], claims: { sub: 'user-1' } }) as unknown as AuthenticationSession;

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
    it('calls next()', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationSession = makeValidSession();

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });
  });
});
