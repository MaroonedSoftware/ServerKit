import { DefaultState, Middleware } from 'koa';
import { ServerKitContext } from './serverkit.context.js';
import { RouterMiddleware } from '@koa/router';

/**
 * Koa middleware type bound to {@link ServerKitContext}.
 * Use this for middleware that relies on ServerKit context (container, logger, etc.).
 *
 * @typeParam ResponseBody - Type of the response body (defaults to `unknown`).
 * @typeParam State - Koa state type (defaults to `DefaultState`).
 * @typeParam Context - Context type (defaults to `ServerKitContext`).
 */
export type ServerKitMiddleware<ResponseBody = unknown, State = DefaultState, Context extends ServerKitContext = ServerKitContext> = Middleware<
  State,
  Context,
  ResponseBody
>;

/**
 * `@koa/router` middleware type bound to {@link ServerKitContext}.
 * Use this for route-level middleware (attached via `router.use()` or inline on route definitions).
 *
 * @typeParam State - Koa state type (defaults to `DefaultState`).
 * @typeParam Context - Context type (defaults to `ServerKitContext`).
 */
export type ServerKitRouterMiddleware<State = DefaultState, Context extends ServerKitContext = ServerKitContext> = RouterMiddleware<State, Context>;
