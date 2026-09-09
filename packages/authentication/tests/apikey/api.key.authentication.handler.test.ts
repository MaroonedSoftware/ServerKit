import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { Injectable, InjectKitRegistry } from 'injectkit';
import { invalidAuthenticationSession, type AuthenticationSession } from '../../src/types.js';
import type { AuthenticationHandler, AuthorizationScheme } from '../../src/authentication.handler.js';
import { AuthenticationHandlerMap, AuthenticationSchemeHandler } from '../../src/authentication.scheme.handler.js';
import { AuthenticationHandlerChain, ChainedAuthenticationHandler } from '../../src/chained.authentication.handler.js';
import { ApiKeyAuthenticationHandler } from '../../src/apikey/api.key.authentication.handler.js';
import { ApiKeyService, ApiKeyServiceOptions } from '../../src/apikey/api.key.service.js';
import { Logger } from '@maroonedsoftware/logger';

const session = (subject: string): AuthenticationSession => {
  const now = DateTime.utc();
  return { sessionToken: 'st', subject, issuedAt: now, lastAccessedAt: now, expiresAt: now.plus({ minutes: 5 }), factors: [], claims: {} };
};

const makeService = (result: AuthenticationSession = session('user-1')) =>
  ({ authenticate: vi.fn(async () => result) }) as unknown as ApiKeyService & { authenticate: ReturnType<typeof vi.fn> };

const makeLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() }) as unknown as Logger;

let service: ReturnType<typeof makeService>;

beforeEach(() => {
  vi.clearAllMocks();
  service = makeService();
});

describe('ApiKeyAuthenticationHandler', () => {
  it('authenticates a bearer token carrying the configured prefix', async () => {
    const handler = new ApiKeyAuthenticationHandler(new ApiKeyServiceOptions(), service);

    await expect(handler.authenticate('bearer', 'sk_live_abc')).resolves.toMatchObject({ subject: 'user-1' });
    expect(service.authenticate).toHaveBeenCalledWith('sk_live_abc');
  });

  it('declines a scheme it was not configured for, without asking the service', async () => {
    const handler = new ApiKeyAuthenticationHandler(new ApiKeyServiceOptions(), service);

    await expect(handler.authenticate('basic', 'sk_live_abc')).resolves.toBe(invalidAuthenticationSession);
    await expect(handler.authenticate('apikey', 'sk_live_abc')).resolves.toBe(invalidAuthenticationSession);
    expect(service.authenticate).not.toHaveBeenCalled();
  });

  it('accepts the apikey scheme when configured for it', async () => {
    const options = new ApiKeyServiceOptions('sk', 32, undefined, undefined, undefined, ['bearer', 'apikey']);
    const handler = new ApiKeyAuthenticationHandler(options, service);

    await expect(handler.authenticate('apikey', 'sk_live_abc')).resolves.toMatchObject({ subject: 'user-1' });
    await expect(handler.authenticate('bearer', 'sk_live_abc')).resolves.toMatchObject({ subject: 'user-1' });
  });

  it('declines a credential without the prefix and never queries for it', async () => {
    const handler = new ApiKeyAuthenticationHandler(new ApiKeyServiceOptions(), service);

    // This is the hot path: every JWT in a chained deployment lands here.
    for (const value of ['eyJhbGciOiJIUzI1NiJ9.e30.sig', 'ghp_something', 'sk', 'sk-live-abc', '']) {
      await expect(handler.authenticate('bearer', value)).resolves.toBe(invalidAuthenticationSession);
    }

    expect(service.authenticate).not.toHaveBeenCalled();
  });

  it('honours a custom prefix', async () => {
    const handler = new ApiKeyAuthenticationHandler(new ApiKeyServiceOptions('acme'), service);

    await expect(handler.authenticate('bearer', 'sk_live_abc')).resolves.toBe(invalidAuthenticationSession);
    await expect(handler.authenticate('bearer', 'acme_live_abc')).resolves.toMatchObject({ subject: 'user-1' });
  });

  it('passes the service sentinel through rather than throwing', async () => {
    const declining = makeService(invalidAuthenticationSession);
    const handler = new ApiKeyAuthenticationHandler(new ApiKeyServiceOptions(), declining);

    // A throw here would stop every handler registered behind this one.
    await expect(handler.authenticate('bearer', 'sk_live_bad')).resolves.toBe(invalidAuthenticationSession);
  });
});

describe('DI wiring', () => {
  @Injectable()
  class StubJwtHandler implements AuthenticationHandler {
    async authenticate(_scheme: AuthorizationScheme, value: string) {
      return value.startsWith('ey') ? session('jwt-user') : invalidAuthenticationSession;
    }
  }

  const build = (options = new ApiKeyServiceOptions()) => {
    const registry = new InjectKitRegistry();
    registry.register(ApiKeyServiceOptions).useValue(options);
    registry.register(ApiKeyService).useValue(service);
    registry.register(ApiKeyAuthenticationHandler).useClass(ApiKeyAuthenticationHandler).asSingleton();
    registry.register(StubJwtHandler).useClass(StubJwtHandler).asSingleton();
    registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain).push(ApiKeyAuthenticationHandler).push(StubJwtHandler);
    registry.register(ChainedAuthenticationHandler).useClass(ChainedAuthenticationHandler).asSingleton();
    registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', ChainedAuthenticationHandler);
    registry.register(Logger).useValue(makeLogger());
    registry.register(AuthenticationSchemeHandler).useClass(AuthenticationSchemeHandler).asSingleton();
    return registry.build();
  };

  it('resolves an API key through the full header path', async () => {
    const handler = build().get(AuthenticationSchemeHandler);

    await expect(handler.handle('Bearer sk_live_abc')).resolves.toMatchObject({ subject: 'user-1' });
  });

  it('lets a JWT fall through to the handler behind it', async () => {
    const handler = build().get(AuthenticationSchemeHandler);

    await expect(handler.handle('Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig')).resolves.toMatchObject({ subject: 'jwt-user' });
    // The API key handler declined on prefix alone, before any lookup.
    expect(service.authenticate).not.toHaveBeenCalled();
  });

  it('dispatches the apikey scheme straight to the handler, no chain', async () => {
    const options = new ApiKeyServiceOptions('sk', 32, undefined, undefined, undefined, ['bearer', 'apikey']);
    const registry = new InjectKitRegistry();
    registry.register(ApiKeyServiceOptions).useValue(options);
    registry.register(ApiKeyService).useValue(service);
    registry.register(ApiKeyAuthenticationHandler).useClass(ApiKeyAuthenticationHandler).asSingleton();
    registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('apikey', ApiKeyAuthenticationHandler);
    registry.register(Logger).useValue(makeLogger());
    registry.register(AuthenticationSchemeHandler).useClass(AuthenticationSchemeHandler).asSingleton();

    // `AuthenticationSchemeHandler` lowercases the scheme before lookup.
    await expect(registry.build().get(AuthenticationSchemeHandler).handle('ApiKey sk_live_abc')).resolves.toMatchObject({ subject: 'user-1' });
  });

  it('returns the sentinel when no handler claims the header', async () => {
    const handler = build().get(AuthenticationSchemeHandler);

    await expect(handler.handle('Bearer ghp_notours')).resolves.toBe(invalidAuthenticationSession);
    await expect(handler.handle(undefined)).resolves.toBe(invalidAuthenticationSession);
  });
});
