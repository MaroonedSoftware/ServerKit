import { describe, it, expect, vi } from 'vitest';
import { AuthenticationSchemeHandler, invalidAuthenticationSession, type AuthenticationSession } from '@maroonedsoftware/authentication';
import type { ServerKitModule } from '@maroonedsoftware/servercore';
import { errorPlugin } from '../../src/plugins/error.plugin.js';
import { serverKitContextPlugin } from '../../src/plugins/serverkit.context.plugin.js';
import { authenticationPlugin, type AuthenticationPluginOptions } from '../../src/plugins/authentication.plugin.js';
import { createTestApp } from '../test.app.js';

const session = { sessionToken: 't', subject: 'alice', factors: [], claims: {} } as unknown as AuthenticationSession;

const build = async (options?: AuthenticationPluginOptions, handle = vi.fn(async () => session)) => {
  const schemeHandler = { handle } as unknown as AuthenticationSchemeHandler;
  const module: ServerKitModule = {
    name: 'auth',
    setup: async registry => void registry.register(AuthenticationSchemeHandler).useInstance(schemeHandler),
  };
  const { app } = await createTestApp({
    modules: [module],
    plugins: container => [errorPlugin(container), serverKitContextPlugin(container), authenticationPlugin(options)],
  });
  let seen: { session: AuthenticationSession; header: string | undefined; rawHeader: string | undefined; rawHeaders: string[] } | undefined;
  app.get('/*', async request => {
    seen = {
      session: request.authenticationSession,
      header: request.headers.authorization,
      rawHeader: request.raw.headers.authorization,
      // `rawHeaders` is a separate array Node fills at parse time; deleting the
      // property does not touch it, so it is asserted on its own.
      rawHeaders: request.raw.rawHeaders.filter(entry => entry.toLowerCase() === 'authorization' || entry.startsWith('Bearer ')),
    };
    return 'ok';
  });
  return { app, handle, seen: () => seen };
};

describe('authenticationPlugin (fastify)', () => {
  it('resolves the Authorization header through the scheme handler and strips it from the request', async () => {
    const { app, handle, seen } = await build();

    const response = await app.inject({ method: 'GET', url: '/private', headers: { authorization: 'Bearer abc' } });

    expect(response.statusCode).toBe(200);
    expect(handle).toHaveBeenCalledWith('Bearer abc');
    expect(seen()).toEqual({ session, header: undefined, rawHeader: undefined, rawHeaders: [] });
  });

  it('strips the credential from rawHeaders, which Node fills separately from headers', async () => {
    // Deleting `headers.authorization` leaves `rawHeaders` untouched, so anything
    // serializing that array would still capture the token.
    const { app } = await build();
    let raw: string[] = [];
    app.addHook('onSend', async request => void (raw = [...request.raw.rawHeaders]));

    await app.inject({ method: 'GET', url: '/private', headers: { authorization: 'Bearer abc' } });

    expect(raw.join('\n')).not.toContain('Bearer abc');
    expect(raw.some(entry => entry.toLowerCase() === 'authorization')).toBe(false);
    expect(raw).toContain('host'); // the other headers survive
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
    expect(seen()).toEqual({ session: invalidAuthenticationSession, header: undefined, rawHeader: undefined, rawHeaders: [] });

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
