import { Container } from 'injectkit';
import { RateLimiter } from '@maroonedsoftware/servercore';
import type { ServerKitPlugin } from '../serverkit.plugin.js';
import { errorPlugin } from './error.plugin.js';
import { serverKitContextPlugin } from './serverkit.context.plugin.js';
import { bodyParserPlugin } from './body.parser.plugin.js';
import { rateLimiterPlugin } from './rate.limiter.plugin.js';
import { corsPlugin } from './cors.plugin.js';
import { authenticationPlugin, AuthenticationPluginOptions } from './authentication.plugin.js';

/**
 * Options for {@link serverKitDefaultPlugins}.
 */
export interface ServerKitDefaultPluginsOptions {
  /** Forwarded to {@link authenticationPlugin}, e.g. to whitelist anonymous paths. */
  authentication?: AuthenticationPluginOptions;
}

/**
 * Builds the default ServerKit plugin stack in canonical order.
 *
 * The stack is: {@link errorPlugin} → {@link serverKitContextPlugin} → {@link bodyParserPlugin} →
 * (optional {@link rateLimiterPlugin}) → {@link corsPlugin} → {@link authenticationPlugin}.
 * The rate limiter is inserted only when a {@link RateLimiter} is registered in the container,
 * so apps that never bind one skip it automatically. The body parser comes after the context
 * plugin because it resolves the parser from `request.container`. Plugins load in registration
 * order and
 * every step after the error handler installs an `onRequest` hook, so the hooks run in exactly
 * this order; a CORS preflight is answered before the authentication hook runs.
 *
 * @param container - The built InjectKit container used to resolve the request-scoped context and, when present, the {@link RateLimiter}.
 * @param options - Optional {@link ServerKitDefaultPluginsOptions} for configuring individual steps in the stack.
 * @returns The ordered plugins to register on the Fastify instance.
 */
export const serverKitDefaultPlugins = (container: Container, options?: ServerKitDefaultPluginsOptions): ServerKitPlugin[] => {
  const plugins: ServerKitPlugin[] = [errorPlugin(container), serverKitContextPlugin(container), bodyParserPlugin()];

  if (container.hasRegistration(RateLimiter)) {
    const rateLimiter = container.get(RateLimiter);
    plugins.push(rateLimiterPlugin(rateLimiter));
  }

  plugins.push(corsPlugin({ exposedHeaders: ['WWW-Authenticate'] }));
  plugins.push(authenticationPlugin(options?.authentication));

  return plugins;
};
