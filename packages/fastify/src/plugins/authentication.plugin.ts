import { AuthenticationSchemeHandler, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { createAnonymousPathMatcher } from '@maroonedsoftware/servercore';
import { serverKitPlugin, type ServerKitPlugin } from '../serverkit.plugin.js';
import { requestPath } from '../request/request.accessors.js';

/**
 * Options for {@link authenticationPlugin}.
 */
export interface AuthenticationPluginOptions {
  /**
   * Paths where the scheme handler is skipped entirely: `request.authenticationSession` stays
   * {@link invalidAuthenticationSession} and no handler is resolved or awaited. Strings match
   * the request path exactly (case-sensitive, no query string, trailing slash significant); use
   * a RegExp for prefixes, e.g. `/^\/public\//`.
   *
   * Safe-by-default: a whitelisted route is indistinguishable from an unauthenticated request,
   * so `requirePolicy` still rejects it if the route demands a session. Use this for genuinely
   * public traffic — health checks, webhooks with their own signatures, public content — where
   * resolving the scheme handler per request is pure overhead.
   */
  anonymousPaths?: (string | RegExp)[];
}

/**
 * Resolves the `Authorization` request header into an {@link AuthenticationSession}
 * and attaches it to `request.authenticationSession`, in an `onRequest` hook.
 *
 * The header is immediately removed from the request headers after being read so it
 * cannot be accidentally captured by downstream logging or serialization. This happens
 * on every route, including whitelisted anonymous ones — it is a logging-safety measure,
 * not an authentication step.
 *
 * Resolution is delegated to the {@link AuthenticationSchemeHandler} registered in
 * the DI container. `request.authenticationSession` is initialised to
 * {@link invalidAuthenticationSession} before delegation, ensuring that any error
 * thrown by the scheme handler leaves the request in a safe, unauthenticated state.
 *
 * Requires `serverKitContextPlugin` to have been registered first, for `request.container`.
 *
 * @param options - Optional {@link AuthenticationPluginOptions}; `anonymousPaths` lists
 * routes that skip scheme-handler resolution entirely.
 * @returns A {@link ServerKitPlugin} that installs the hook.
 *
 * @example
 * ```typescript
 * builder.setupPlugins(container => serverKitDefaultPlugins(container, { authentication: { anonymousPaths: ['/health', /^\/public\//] } }));
 * ```
 */
export const authenticationPlugin = (options?: AuthenticationPluginOptions): ServerKitPlugin => {
  // Precompiled once at construction: O(1) for exact paths, a linear scan only for patterns.
  const isAnonymous = createAnonymousPathMatcher(options?.anonymousPaths);

  return serverKitPlugin('serverkit.authentication', async app => {
    app.addHook('onRequest', async request => {
      request.authenticationSession = invalidAuthenticationSession; // bad initial state so it will fail verification

      // NOTE: we delete the auth header on both header views so we don't accidentally log it
      const authorizationHeader = request.headers.authorization;
      delete request.headers.authorization;
      delete request.raw.headers.authorization;

      if (!isAnonymous(requestPath(request))) {
        const schemeHandler = request.container.get(AuthenticationSchemeHandler);

        request.authenticationSession = await schemeHandler.handle(authorizationHeader);
      }
    });
  });
};
