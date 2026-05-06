import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { AuthenticationSchemeHandler, invalidAuthenticationSession } from '@maroonedsoftware/authentication';

/**
 * Resolves the `Authorization` request header into an {@link AuthenticationSession}
 * and attaches it to `ctx.authenticationSession`.
 *
 * The header is immediately removed from `ctx.req.headers` after being read so it
 * cannot be accidentally captured by downstream logging or serialization.
 *
 * Resolution is delegated to the {@link AuthenticationSchemeHandler} registered in
 * the DI container. `ctx.authenticationSession` is initialised to
 * {@link invalidAuthenticationSession} before delegation, ensuring that any error
 * thrown by the scheme handler leaves the context in a safe, unauthenticated state.
 *
 * @returns A {@link ServerKitMiddleware} that populates `ctx.authenticationSession`.
 *
 * @example
 * ```typescript
 * app.use(authenticationMiddleware());
 * ```
 */
export const authenticationMiddleware = (): ServerKitMiddleware => {
  return async (ctx, next) => {
    ctx.authenticationSession = invalidAuthenticationSession; // bad initial state so it will fail verification

    // NOTE: we delete the auth headers on the request here to ensure we don't accidentally log it
    const authorizationHeader = ctx.req.headers.authorization;
    delete ctx.req.headers.authorization;

    const schemeHandler = ctx.container.get(AuthenticationSchemeHandler);

    ctx.authenticationSession = await schemeHandler.handle(authorizationHeader);

    await next();
  };
};
