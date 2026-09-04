import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { AuthenticationSchemeHandler, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { createAnonymousPathMatcher, stripRawAuthorizationHeader } from '@maroonedsoftware/servercore';

/**
 * Options for {@link authenticationMiddleware}.
 */
export interface AuthenticationMiddlewareOptions {
  /**
   * Paths where the scheme handler is skipped entirely: `ctx.authenticationSession` stays
   * {@link invalidAuthenticationSession} and no handler is resolved or awaited. Strings match
   * `ctx.path` exactly (case-sensitive, no query string, trailing slash significant); use a
   * RegExp for prefixes, e.g. `/^\/public\//`.
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
 * and attaches it to `ctx.authenticationSession`.
 *
 * The header is immediately removed from the request after being read so it cannot be
 * accidentally captured by downstream logging or serialization: from `ctx.req.headers`
 * and from `ctx.req.rawHeaders`, which Node populates separately and does not keep in
 * sync with the former. This happens on every route, including whitelisted anonymous
 * ones — it is a logging-safety measure, not an authentication step.
 *
 * It also means nothing downstream can re-read the credential. A guard that needs the
 * raw header belongs in an {@link AuthenticationSchemeHandler} handler instead.
 *
 * Resolution is delegated to the {@link AuthenticationSchemeHandler} registered in
 * the DI container. `ctx.authenticationSession` is initialised to
 * {@link invalidAuthenticationSession} before delegation, ensuring that any error
 * thrown by the scheme handler leaves the context in a safe, unauthenticated state.
 *
 * @param options - Optional {@link AuthenticationMiddlewareOptions}; `anonymousPaths` lists
 * routes that skip scheme-handler resolution entirely.
 * @returns A {@link ServerKitMiddleware} that populates `ctx.authenticationSession`.
 *
 * @example
 * ```typescript
 * app.use(authenticationMiddleware());
 * // or, with public routes that skip the scheme handler:
 * app.use(authenticationMiddleware({ anonymousPaths: ['/health', /^\/public\//] }));
 * ```
 */
export const authenticationMiddleware = (options?: AuthenticationMiddlewareOptions): ServerKitMiddleware => {
  // Precompiled once at construction: O(1) for exact paths, a linear scan only for patterns.
  const isAnonymous = createAnonymousPathMatcher(options?.anonymousPaths);

  return async (ctx, next) => {
    ctx.authenticationSession = invalidAuthenticationSession; // bad initial state so it will fail verification

    // NOTE: we remove the auth header from every view of the request here to ensure we
    // don't accidentally log it. `rawHeaders` is populated separately from `headers` at
    // parse time and is not kept in sync, so deleting the property is not enough.
    const authorizationHeader = ctx.req.headers.authorization;
    delete ctx.req.headers.authorization;
    stripRawAuthorizationHeader(ctx.req.rawHeaders);

    if (!isAnonymous(ctx.path)) {
      const schemeHandler = ctx.container.get(AuthenticationSchemeHandler);

      ctx.authenticationSession = await schemeHandler.handle(authorizationHeader);
    }

    await next();
  };
};
