import type { FastifyReply } from 'fastify';
import type { ServerKitContext } from './serverkit.context.js';

/**
 * A route-level guard, run as a Fastify `preHandler` before the route handler. Throw (an
 * `HttpError`, usually) to reject the request; resolve to let it through. Fastify runs the
 * guards in the order given, then the handler.
 */
export type ServerKitRouterMiddleware = (request: ServerKitContext, reply: FastifyReply) => Promise<void>;

/**
 * A route handler. Return a value (or a promise of one) to send it as the response body, or write
 * through `reply` directly. A handler that returns `undefined` without replying leaves the request
 * hanging, as in any Fastify app.
 */
export type ServerKitRouteHandler = (request: ServerKitContext, reply: FastifyReply) => unknown;
