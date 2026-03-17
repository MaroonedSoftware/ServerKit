import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireSecurity } from '../../../src/middleware/router/require.security.middleware.js';
import { invalidAuthenticationContext, type AuthenticationContext } from '@maroonedsoftware/authentication';
import { HttpError } from '@maroonedsoftware/errors';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';

const makeValidContext = (roles: string[] = []): AuthenticationContext =>
  ({ authenticationId: 'auth-123', factors: [], claims: { sub: 'user-1' }, roles }) as unknown as AuthenticationContext;

describe('requireSecurity', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNext = vi.fn().mockResolvedValue(undefined);
    mockCtx = {
      authenticationContext: invalidAuthenticationContext,
    } as unknown as ServerKitContext;
  });

  it('returns a middleware function', () => {
    const middleware = requireSecurity();
    expect(middleware).toBeTypeOf('function');
  });

  describe('when authenticationContext is invalid', () => {
    it('throws a 401 error', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationContext = invalidAuthenticationContext;

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
      mockCtx.authenticationContext = invalidAuthenticationContext;

      try {
        await middleware(mockCtx, mockNext);
      } catch (error) {
        expect((error as HttpError).headers?.['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
      }
    });

    it('does not call next()', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationContext = invalidAuthenticationContext;

      await expect(middleware(mockCtx, mockNext)).rejects.toThrow();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('when authenticationContext is valid', () => {
    it('calls next() when no role is required', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationContext = makeValidContext();

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('calls next() when role is required and user has it', async () => {
      const middleware = requireSecurity({ roles: ['admin'] });
      mockCtx.authenticationContext = makeValidContext(['admin', 'user']);

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('throws 403 when role is required and user does not have it', async () => {
      const middleware = requireSecurity({ roles: ['admin'] });
      mockCtx.authenticationContext = makeValidContext(['user']);

      await expect(middleware(mockCtx, mockNext)).rejects.toThrow(HttpError);

      try {
        await middleware(mockCtx, mockNext);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).statusCode).toBe(403);
      }
    });

    it('does not call next() when role check fails', async () => {
      const middleware = requireSecurity({ roles: ['admin'] });
      mockCtx.authenticationContext = makeValidContext(['user']);

      await expect(middleware(mockCtx, mockNext)).rejects.toThrow();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('throws 403 when role is required and user has no roles', async () => {
      const middleware = requireSecurity({ roles: ['admin'] });
      mockCtx.authenticationContext = makeValidContext([]);

      await expect(middleware(mockCtx, mockNext)).rejects.toThrow(HttpError);

      try {
        await middleware(mockCtx, mockNext);
      } catch (error) {
        expect((error as HttpError).statusCode).toBe(403);
      }
    });

    it('does not check roles when no role option is provided', async () => {
      const middleware = requireSecurity();
      mockCtx.authenticationContext = makeValidContext([]);

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('does not check roles when options object has no role property', async () => {
      const middleware = requireSecurity({});
      mockCtx.authenticationContext = makeValidContext([]);

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('calls next() when user has one of multiple required roles', async () => {
      const middleware = requireSecurity({ roles: ['admin', 'moderator'] });
      mockCtx.authenticationContext = makeValidContext(['moderator']);

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('calls next() when roles is an empty array', async () => {
      const middleware = requireSecurity({ roles: [] });
      mockCtx.authenticationContext = makeValidContext(['admin']);

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });
  });
});
