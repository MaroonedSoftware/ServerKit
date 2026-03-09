import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { authenticationMiddleware } from '../../../src/middleware/server/authentication.middleware.js';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';
import { invalidAuthenticationContext, type AuthenticationContext } from '@maroonedsoftware/authentication';

const makeValidContext = (): AuthenticationContext =>
  ({ authenticationId: 'auth-123', factors: [], claims: { sub: 'user-1' } }) as unknown as AuthenticationContext;

describe('authenticationMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;
  let mockSchemeHandler: { handle: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSchemeHandler = {
      handle: vi.fn().mockResolvedValue(invalidAuthenticationContext),
    };

    mockNext = vi.fn().mockResolvedValue(undefined);

    mockCtx = {
      req: { headers: { authorization: undefined } },
      serviceLocator: { get: vi.fn().mockReturnValue(mockSchemeHandler) },
    } as unknown as ServerKitContext;
  });

  it('returns a middleware function', () => {
    const middleware = authenticationMiddleware();

    expect(middleware).toBeTypeOf('function');
    expect(middleware.length).toBe(2);
  });

  it('sets authenticationContext to invalidAuthenticationContext before delegating', async () => {
    let contextDuringHandle: AuthenticationContext | undefined;
    mockSchemeHandler.handle.mockImplementation(async () => {
      contextDuringHandle = mockCtx.authenticationContext;
      return invalidAuthenticationContext;
    });
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(contextDuringHandle).toBe(invalidAuthenticationContext);
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

  it('sets ctx.authenticationContext to the value returned by schemeHandler.handle', async () => {
    const validContext = makeValidContext();
    mockSchemeHandler.handle.mockResolvedValue(validContext);
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockCtx.authenticationContext).toBe(validContext);
  });

  it('sets ctx.authenticationContext to invalidAuthenticationContext when handle returns it', async () => {
    mockSchemeHandler.handle.mockResolvedValue(invalidAuthenticationContext);
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockCtx.authenticationContext).toBe(invalidAuthenticationContext);
  });

  it('calls next() after resolving the authentication context', async () => {
    const validContext = makeValidContext();
    mockSchemeHandler.handle.mockResolvedValue(validContext);
    const middleware = authenticationMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
    expect(mockCtx.authenticationContext).toBe(validContext);
  });

  it('calls next() even when handle returns invalidAuthenticationContext', async () => {
    mockSchemeHandler.handle.mockResolvedValue(invalidAuthenticationContext);
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
