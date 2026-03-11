import { DefaultState } from 'koa';
import Router, { RouterOptions } from '@koa/router';
import { ServerKitContext } from './serverkit.context.js';

/**
 * Creates a new Koa router typed for ServerKit state and context.
 * Use with {@link ServerKitContext} for full typing of `ctx` in route handlers.
 *
 * @typeParam StateT - Koa state type (defaults to `DefaultState`).
 * @typeParam ContextT - Context type (defaults to `ServerKitContext`).
 * @param options - Router options (defaults to `undefined`).
 * @returns A new {@link Router} instance with the given options.
 */
export const ServerKitRouter = <StateT = DefaultState, ContextT = ServerKitContext>(options?: RouterOptions) => new Router<StateT, ContextT>(options);
