import { Container } from 'injectkit';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { errorMiddleware } from './error.middleware.js';
import { serverKitContextMiddleware } from './serverkit.context.middleware.js';

/**
 * Builds the default ServerKit middleware stack in canonical order:
 * {@link errorMiddleware} → {@link serverKitContextMiddleware}.
 *
 * @param container - The built InjectKit container used to resolve the request-scoped context.
 * @returns The ordered registration steps to apply to the Fastify instance.
 */
export const serverKitDefaultMiddleware = (container: Container): ServerKitMiddleware[] => {
  return [errorMiddleware(container), serverKitContextMiddleware(container)];
};
