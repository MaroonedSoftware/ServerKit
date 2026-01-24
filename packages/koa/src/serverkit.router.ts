import { DefaultState } from 'koa';
import Router from '@koa/router';
import { ServerKitContext } from './serverkit.context.js';

export const ServerKitRouter = <StateT = DefaultState, ContextT = ServerKitContext>() => new Router<StateT, ContextT>();
