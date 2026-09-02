import { describe, it, expect, vi } from 'vitest';
import { AuthenticationSchemeHandler, invalidAuthenticationSession, type AuthenticationSession } from '@maroonedsoftware/authentication';
import type { ServerKitModule } from '@maroonedsoftware/servercore';
import { errorMiddleware } from '../../../src/middleware/server/error.middleware.js';
import { serverKitContextMiddleware } from '../../../src/middleware/server/serverkit.context.middleware.js';
import { authenticationMiddleware, type AuthenticationMiddlewareOptions } from '../../../src/middleware/server/authentication.middleware.js';
import { createTestApp } from '../../test.app.js';

const session = { sessionToken: 't', subject: 'alice', factors: [], claims: {} } as unknown as AuthenticationSession;

const build = async (options?: AuthenticationMiddlewareOptions, handle = vi.fn(async () => session)) => {
  const schemeHandler = { handle } as unknown as AuthenticationSchemeHandler;
  const module: ServerKitModule = {
    name: 'auth',
    setup: async registry => void registry.register(AuthenticationSchemeHandler).useInstance(schemeHandler),
  };
  const { app } = await createTestApp({
    modules: [module],
    middleware: container => [errorMiddleware(container), serverKitContextMiddleware(container), authenticationMiddleware(options)],
  });
  let seen: { session: AuthenticationSession; header: string | undefined; rawHeader: string | undefined } | undefined;
  app.get('/*', async request => {
    seen = { session: request.authenticationSession, header: request.headers.authorization, rawHeader: request.raw.headers.authorization };
    return 'ok';
  });
  return { app, handle, seen: () => seen };
};

describe('authenticationMiddleware (fastify)', () => {
  it('resolves the Authorization header through the scheme handler and strips it from the request', async () => {
    const { app, handle, seen } = await build();

    const response = await app.inject({ method: 'GET', url: '/private', headers: { authorization: 'Bearer abc' } });

    expect(response.statusCode).toBe(200);
    expect(handle).toHaveBeenCalledWith('Bearer abc');
    expect(seen()).toEqual({ session, header: undefined, rawHeader: undefined });
  });

  it('passes an absent header to the scheme handler', async () => {
    const { app, handle } = await build();

    await app.inject({ method: 'GET', url: '/private' });

    expect(handle).toHaveBeenCalledWith(undefined);
  });

  it('skips the scheme handler on anonymous paths but still strips the header', async () => {
    const { app, handle, seen } = await build({ anonymousPaths: ['/health', /^\/public\//] });

    await app.inject({ method: 'GET', url: '/health?x=1', headers: { authorization: 'Bearer abc' } });
    expect(handle).not.toHaveBeenCalled();
    expect(seen()).toEqual({ session: invalidAuthenticationSession, header: undefined, rawHeader: undefined });

    await app.inject({ method: 'GET', url: '/public/logo.png' });
    expect(handle).not.toHaveBeenCalled();

    await app.inject({ method: 'GET', url: '/healthz' });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('leaves the session invalid and renders the error when the scheme handler throws', async () => {
    const { app } = await build(
      undefined,
      vi.fn(async () => Promise.reject(new Error('bad token'))),
    );

    const response = await app.inject({ method: 'GET', url: '/private', headers: { authorization: 'Bearer nope' } });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ statusCode: 500, message: 'Internal Server Error' });
  });
});
