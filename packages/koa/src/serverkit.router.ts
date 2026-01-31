import { DefaultState } from 'koa';
import Router from '@koa/router';
import { ServerKitContext } from './serverkit.context.js';

/**
 * Creates a new Koa router typed for ServerKit state and context.
 * Use with {@link ServerKitContext} for full typing of `ctx` in route handlers.
 *
 * @typeParam StateT - Koa state type (defaults to `DefaultState`).
 * @typeParam ContextT - Context type (defaults to `ServerKitContext`).
 * @returns A new {@link Router} instance.
 */
export const ServerKitRouter = <StateT = DefaultState, ContextT = ServerKitContext>() => new Router<StateT, ContextT>();
