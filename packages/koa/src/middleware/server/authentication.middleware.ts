import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { AuthenticationSchemeHandler, invalidAuthenticationContext } from '@maroonedsoftware/authentication';

/**
 * Resolves the `Authorization` request header into an {@link AuthenticationContext}
 * and attaches it to `ctx.authenticationContext`.
 *
 * The header is immediately removed from `ctx.req.headers` after being read so it
 * cannot be accidentally captured by downstream logging or serialization.
 *
 * Resolution is delegated to the {@link AuthenticationSchemeHandler} registered in
 * the DI container. `ctx.authenticationContext` is initialised to
 * {@link invalidAuthenticationContext} before delegation, ensuring that any error
 * thrown by the scheme handler leaves the context in a safe, unauthenticated state.
 *
 * @returns A {@link ServerKitMiddleware} that populates `ctx.authenticationContext`.
 *
 * @example
 * ```typescript
 * app.use(authenticationMiddleware());
 * ```
 */
export const authenticationMiddleware = (): ServerKitMiddleware => {
  return async (ctx, next) => {
    ctx.authenticationContext = invalidAuthenticationContext; // bad initial state so it will fail verification

    // NOTE: we delete the auth headers on the request here to ensure we don't accidentally log it
    const authorizationHeader = ctx.req.headers.authorization;
    delete ctx.req.headers.authorization;

    const schemeHandler = ctx.serviceLocator.get(AuthenticationSchemeHandler);

    ctx.authenticationContext = await schemeHandler.handle(authorizationHeader);

    await next();
  };
};
