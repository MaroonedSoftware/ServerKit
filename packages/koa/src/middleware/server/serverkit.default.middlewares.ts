import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { Container } from 'injectkit';
import { errorMiddleware } from './error.middleware.js';
import { serverKitContextMiddleware } from './serverkit.context.middleware.js';
import { RateLimiter, rateLimiterMiddleware } from './rate.limiter.middleware.js';
import { corsMiddleware } from './cors.middleware.js';
import { authenticationMiddleware } from './authentication.middleware.js';

/**
 * Builds the default ServerKit middleware stack in canonical order.
 *
 * The stack is: {@link errorMiddleware} → {@link serverKitContextMiddleware} → (optional
 * {@link rateLimiterMiddleware}) → {@link corsMiddleware} → {@link authenticationMiddleware}.
 * The rate limiter is inserted only when a {@link RateLimiter} is registered in the container,
 * so apps that never bind one skip it automatically.
 *
 * @param container - The built InjectKit container used to resolve the request-scoped context and, when present, the {@link RateLimiter}.
 * @returns The ordered middleware array to register on the Koa server.
 */
export const serverKitDefaultMiddleware = (container: Container): ServerKitMiddleware[] => {
  const middlewares: ServerKitMiddleware[] = [errorMiddleware(), serverKitContextMiddleware(container)];

  if (container.hasRegistration(RateLimiter)) {
    const rateLimiter = container.get(RateLimiter);
    middlewares.push(rateLimiterMiddleware(rateLimiter));
  }

  middlewares.push(corsMiddleware({ exposeHeaders: ['WWW-Authenticate'] }));
  middlewares.push(authenticationMiddleware());

  return middlewares;
};
