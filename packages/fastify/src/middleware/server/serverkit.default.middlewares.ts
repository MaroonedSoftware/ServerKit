import { Container } from 'injectkit';
import { RateLimiter } from '@maroonedsoftware/servercore';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { errorMiddleware } from './error.middleware.js';
import { serverKitContextMiddleware } from './serverkit.context.middleware.js';
import { rateLimiterMiddleware } from './rate.limiter.middleware.js';
import { corsMiddleware } from './cors.middleware.js';
import { authenticationMiddleware, AuthenticationMiddlewareOptions } from './authentication.middleware.js';

/**
 * Options for {@link serverKitDefaultMiddleware}.
 */
export interface ServerKitDefaultMiddlewareOptions {
  /** Forwarded to {@link authenticationMiddleware}, e.g. to whitelist anonymous paths. */
  authentication?: AuthenticationMiddlewareOptions;
}

/**
 * Builds the default ServerKit middleware stack in canonical order.
 *
 * The stack is: {@link errorMiddleware} → {@link serverKitContextMiddleware} → (optional
 * {@link rateLimiterMiddleware}) → {@link corsMiddleware} → {@link authenticationMiddleware}.
 * The rate limiter is inserted only when a {@link RateLimiter} is registered in the container,
 * so apps that never bind one skip it automatically. Every step after the error handler is an
 * `onRequest` hook, so the hooks run in exactly this order; a CORS preflight is answered before
 * the authentication hook runs.
 *
 * @param container - The built InjectKit container used to resolve the request-scoped context and, when present, the {@link RateLimiter}.
 * @param options - Optional {@link ServerKitDefaultMiddlewareOptions} for configuring individual steps in the stack.
 * @returns The ordered registration steps to apply to the Fastify instance.
 */
export const serverKitDefaultMiddleware = (container: Container, options?: ServerKitDefaultMiddlewareOptions): ServerKitMiddleware[] => {
  const middlewares: ServerKitMiddleware[] = [errorMiddleware(container), serverKitContextMiddleware(container)];

  if (container.hasRegistration(RateLimiter)) {
    const rateLimiter = container.get(RateLimiter);
    middlewares.push(rateLimiterMiddleware(rateLimiter));
  }

  middlewares.push(corsMiddleware({ exposedHeaders: ['WWW-Authenticate'] }));
  middlewares.push(authenticationMiddleware(options?.authentication));

  return middlewares;
};
