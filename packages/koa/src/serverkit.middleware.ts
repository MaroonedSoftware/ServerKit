import { DefaultState, Middleware } from 'koa';
import { ServerKitContext } from './serverkit.context.js';

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
