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
      req: { headers: { authorization: undefined } },
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
});
