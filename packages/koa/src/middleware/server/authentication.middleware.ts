import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { AuthenticationSchemeHandler, invalidAuthenticationSession } from '@maroonedsoftware/authentication';

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
 * The header is immediately removed from `ctx.req.headers` after being read so it
 * cannot be accidentally captured by downstream logging or serialization. This happens
 * on every route, including whitelisted anonymous ones — it is a logging-safety measure,
 * not an authentication step.
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
  const exactPaths = new Set<string>();
  const patterns: RegExp[] = [];
  for (const path of options?.anonymousPaths ?? []) {
    if (typeof path === 'string') {
      exactPaths.add(path);
    } else {
      patterns.push(path);
    }
  }
  const isAnonymous = (path: string): boolean => exactPaths.has(path) || patterns.some(pattern => pattern.test(path));

  return async (ctx, next) => {
    ctx.authenticationSession = invalidAuthenticationSession; // bad initial state so it will fail verification

    // NOTE: we delete the auth headers on the request here to ensure we don't accidentally log it
    const authorizationHeader = ctx.req.headers.authorization;
    delete ctx.req.headers.authorization;

    if (!isAnonymous(ctx.path)) {
      const schemeHandler = ctx.container.get(AuthenticationSchemeHandler);

      ctx.authenticationSession = await schemeHandler.handle(authorizationHeader);
    }

    await next();
  };
};
