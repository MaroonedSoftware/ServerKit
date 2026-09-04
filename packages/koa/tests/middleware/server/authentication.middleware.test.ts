import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { authenticationMiddleware } from '../../../src/middleware/server/authentication.middleware.js';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';
import { invalidAuthenticationSession, type AuthenticationSession } from '@maroonedsoftware/authentication';

const makeValidSession = (): AuthenticationSession =>
  ({ subject: 'user-1', sessionToken: 'session-token-123', factors: [], claims: { sub: 'user-1' } }) as unknown as AuthenticationSession;

describe('authenticationMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;
  let mockSchemeHandler: { handle: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSchemeHandler = {
      handle: vi.fn().mockResolvedValue(invalidAuthenticationSession),
    };

    mockNext = vi.fn().mockResolvedValue(undefined);

    mockCtx = {
      path: '/api/example',
      req: { headers: { authorization: undefined }, rawHeaders: [] },
      container: { get: vi.fn().mockReturnValue(mockSchemeHandler) },
    } as unknown as ServerKitContext;
  });

  it('returns a middleware function', () => {
    const middleware = authenticationMiddleware();

    expect(middleware).toBeTypeOf('function');
    expect(middleware.length).toBe(2);
  });

  it('sets authenticationSession to invalidAuthenticationSession before delegating', async () => {
    let sessionDuringHandle: AuthenticationSession | undefined;
    mockSchemeHandler.handle.mockImplementation(async () => {
      sessionDuringHandle = mockCtx.authenticationSession;
      return invalidAuthenticationSession;
    });
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(sessionDuringHandle).toBe(invalidAuthenticationSession);
  });

  it('deletes the authorization header from req.headers', async () => {
    mockCtx.req.headers.authorization = 'Bearer token';
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockCtx.req.headers.authorization).toBeUndefined();
  });

  it('strips the credential from req.rawHeaders, which Node fills separately from headers', async () => {
    // Deleting `headers.authorization` leaves `rawHeaders` untouched, so anything
    // serializing that array would still capture the token.
    mockCtx.req.headers.authorization = 'Bearer token';
    mockCtx.req.rawHeaders = ['Host', 'example.com', 'Authorization', 'Bearer token'];
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockCtx.req.rawHeaders).toEqual(['Host', 'example.com']);
  });

  it('passes the authorization header value to schemeHandler.handle', async () => {
    mockCtx.req.headers.authorization = 'Bearer mytoken';
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockSchemeHandler.handle).toHaveBeenCalledWith('Bearer mytoken');
  });

  it('passes undefined to schemeHandler.handle when no authorization header is present', async () => {
    mockCtx.req.headers.authorization = undefined;
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockSchemeHandler.handle).toHaveBeenCalledWith(undefined);
  });

  it('sets ctx.authenticationSession to the value returned by schemeHandler.handle', async () => {
    const validSession = makeValidSession();
    mockSchemeHandler.handle.mockResolvedValue(validSession);
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockCtx.authenticationSession).toBe(validSession);
  });

  it('sets ctx.authenticationSession to invalidAuthenticationSession when handle returns it', async () => {
    mockSchemeHandler.handle.mockResolvedValue(invalidAuthenticationSession);
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockCtx.authenticationSession).toBe(invalidAuthenticationSession);
  });

  it('calls next() after resolving the authentication context', async () => {
    const validSession = makeValidSession();
    mockSchemeHandler.handle.mockResolvedValue(validSession);
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
    expect(mockCtx.authenticationSession).toBe(validSession);
  });

  it('calls next() even when handle returns invalidAuthenticationSession', async () => {
    mockSchemeHandler.handle.mockResolvedValue(invalidAuthenticationSession);
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('propagates errors thrown by schemeHandler.handle', async () => {
    const error = new Error('handler failure');
    mockSchemeHandler.handle.mockRejectedValue(error);
    const middleware = authenticationMiddleware();

    await expect(middleware(mockCtx, mockNext)).rejects.toThrow('handler failure');
    expect(mockNext).not.toHaveBeenCalled();
  });

  describe('anonymousPaths', () => {
    it('skips the scheme handler entirely on an exactly-matched path', async () => {
      (mockCtx as { path: string }).path = '/health';
      const middleware = authenticationMiddleware({ anonymousPaths: ['/health'] });

      await middleware(mockCtx, mockNext);

      expect(mockCtx.container.get).not.toHaveBeenCalled();
      expect(mockSchemeHandler.handle).not.toHaveBeenCalled();
      expect(mockCtx.authenticationSession).toBe(invalidAuthenticationSession);
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('still deletes the authorization header on a whitelisted path', async () => {
      // The deletion is a logging-safety measure, not an authentication step — it must
      // happen whether or not the scheme handler runs.
      (mockCtx as { path: string }).path = '/health';
      mockCtx.req.headers.authorization = 'Bearer token';
      mockCtx.req.rawHeaders = ['Authorization', 'Bearer token'];
      const middleware = authenticationMiddleware({ anonymousPaths: ['/health'] });

      await middleware(mockCtx, mockNext);

      expect(mockCtx.req.headers.authorization).toBeUndefined();
      expect(mockCtx.req.rawHeaders).toEqual([]);
    });

    it('matches a RegExp entry', async () => {
      (mockCtx as { path: string }).path = '/public/logo.png';
      const middleware = authenticationMiddleware({ anonymousPaths: [/^\/public\//] });

      await middleware(mockCtx, mockNext);

      expect(mockSchemeHandler.handle).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('does not treat a string entry as a prefix', async () => {
      // '/health' must not cover '/healthz' — silent over-matching is why strings are
      // exact and RegExp is the explicit escape hatch.
      (mockCtx as { path: string }).path = '/healthz';
      const middleware = authenticationMiddleware({ anonymousPaths: ['/health'] });

      await middleware(mockCtx, mockNext);

      expect(mockSchemeHandler.handle).toHaveBeenCalledWith(undefined);
    });

    it('authenticates non-matching paths as before', async () => {
      const validSession = makeValidSession();
      mockSchemeHandler.handle.mockResolvedValue(validSession);
      mockCtx.req.headers.authorization = 'Bearer mytoken';
      const middleware = authenticationMiddleware({ anonymousPaths: ['/health', /^\/public\//] });

      await middleware(mockCtx, mockNext);

      expect(mockSchemeHandler.handle).toHaveBeenCalledWith('Bearer mytoken');
      expect(mockCtx.authenticationSession).toBe(validSession);
    });

    it('behaves as unconfigured when anonymousPaths is empty', async () => {
      const middleware = authenticationMiddleware({ anonymousPaths: [] });

      await middleware(mockCtx, mockNext);

      expect(mockSchemeHandler.handle).toHaveBeenCalledWith(undefined);
    });
  });
});
