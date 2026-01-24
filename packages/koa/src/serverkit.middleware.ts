import { DefaultState, Middleware } from 'koa';
import { ServerKitContext } from './serverkit.context.js';

export interface ServerKitMiddleware<
  ResponseBody = unknown,
  State = DefaultState,
  Context extends ServerKitContext = ServerKitContext,
> extends Middleware<State, Context, ResponseBody> {}
