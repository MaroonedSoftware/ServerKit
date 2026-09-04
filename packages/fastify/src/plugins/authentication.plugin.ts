import { AuthenticationSchemeHandler, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { createAnonymousPathMatcher, stripRawAuthorizationHeader } from '@maroonedsoftware/servercore';
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
 * The header is immediately removed from the request after being read so it cannot be
 * accidentally captured by downstream logging or serialization: from `request.headers`,
 * `request.raw.headers`, and `request.raw.rawHeaders`, which Node populates separately
 * and does not keep in sync with the others. This happens on every route, including
 * whitelisted anonymous ones — it is a logging-safety measure, not an authentication step.
 *
 * It also means nothing downstream can re-read the credential. A guard that needs the
 * raw header belongs in an {@link AuthenticationSchemeHandler} handler instead.
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

      // NOTE: we remove the auth header from every view of the request so we don't
      // accidentally log it. `rawHeaders` is populated separately from `headers` at
      // parse time and is not kept in sync, so deleting the property is not enough.
      const authorizationHeader = request.headers.authorization;
      delete request.headers.authorization;
      delete request.raw.headers.authorization;
      stripRawAuthorizationHeader(request.raw.rawHeaders);

      if (!isAnonymous(requestPath(request))) {
        const schemeHandler = request.container.get(AuthenticationSchemeHandler);

        request.authenticationSession = await schemeHandler.handle(authorizationHeader);
      }
    });
  });
};
