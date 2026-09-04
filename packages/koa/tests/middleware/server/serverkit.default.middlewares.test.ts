import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { serverKitDefaultMiddleware } from '../../../src/middleware/server/serverkit.default.middlewares.js';
import { RateLimiter } from '../../../src/middleware/server/rate.limiter.middleware.js';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';
import type { Container } from 'injectkit';
import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';

describe('serverKitDefaultMiddleware', () => {
  let mockContainer: {
    hasRegistration: Mock;
    get: Mock;
    createScopedContainer: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockContainer = {
      hasRegistration: vi.fn().mockReturnValue(false),
      get: vi.fn(),
      createScopedContainer: vi.fn(),
    };
  });

  it('builds the canonical four-middleware stack when no rate limiter is registered', () => {
    const stack = serverKitDefaultMiddleware(mockContainer as unknown as Container);

    // error → context → cors → authentication
    expect(stack).toHaveLength(4);
    expect(stack.every(middleware => typeof middleware === 'function')).toBe(true);
    expect(mockContainer.hasRegistration).toHaveBeenCalledWith(RateLimiter);
  });

  it('inserts the rate limiter only when one is registered', () => {
    mockContainer.hasRegistration.mockImplementation((id: unknown) => id === RateLimiter);
    mockContainer.get.mockReturnValue({ consume: vi.fn() });

    const stack = serverKitDefaultMiddleware(mockContainer as unknown as Container);

    expect(stack).toHaveLength(5);
    expect(mockContainer.get).toHaveBeenCalledWith(RateLimiter);
  });

  it('forwards authentication options to the authentication middleware', async () => {
    // Assert via behavior: run the stack's authentication middleware (last entry) against a
    // whitelisted path and confirm the scheme handler is never resolved.
    const stack = serverKitDefaultMiddleware(mockContainer as unknown as Container, {
      authentication: { anonymousPaths: ['/health'] },
    });
    const authentication = stack[stack.length - 1]!;

    const containerGet = vi.fn();
    const ctx = {
      path: '/health',
      req: { headers: {}, rawHeaders: [] },
      container: { get: containerGet },
    } as unknown as ServerKitContext;
    const next: Next = vi.fn().mockResolvedValue(undefined);

    await authentication(ctx, next);

    expect(containerGet).not.toHaveBeenCalled();
    expect(ctx.authenticationSession).toBe(invalidAuthenticationSession);
    expect(next).toHaveBeenCalledOnce();
  });
});
