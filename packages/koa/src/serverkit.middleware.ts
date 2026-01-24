import { DefaultState, Middleware } from 'koa';
import { ServerKitContext } from './serverkit.context.js';

export type ServerKitMiddleware<ResponseBody = unknown, State = DefaultState, Context extends ServerKitContext = ServerKitContext> = Middleware<
  State,
  Context,
  ResponseBody
>;
