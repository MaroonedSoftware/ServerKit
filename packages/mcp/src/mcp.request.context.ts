import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from '@maroonedsoftware/logger';
import type { McpAuthInfo } from './mcp.auth.js';

/**
 * Per-tool view of the request context handed to an
 * {@link import('./mcp.tool.handler.js').McpToolHandler}. Everything a handler
 * needs that is request-scoped rather than singleton.
 */
export interface McpToolContext {
  /** Correlation/request id for this MCP call (from `ctx.requestId`). */
  requestId: string;
  /** Request-scoped logger (from `ctx.logger`). */
  logger: Logger;
  /** Authenticated subject, if the auth policy resolved one. */
  auth?: McpAuthInfo;
  /** Name of the tool being invoked. */
  toolName: string;
  /** Abort signal for the invocation (cancellation / timeout), when available. */
  signal?: AbortSignal;
}

/**
 * Per-resource view of the request context handed to an
 * {@link import('./mcp.resource.handler.js').McpResourceHandler}.
 */
export interface McpResourceContext {
  /** Correlation/request id for this MCP call. */
  requestId: string;
  /** Request-scoped logger. */
  logger: Logger;
  /** Authenticated subject, if the auth policy resolved one. */
  auth?: McpAuthInfo;
  /** URI of the resource being read. */
  uri: string;
  /** Abort signal for the invocation, when available. */
  signal?: AbortSignal;
}

/**
 * Request-scoped context threaded to MCP handlers. Deliberately transport-neutral
 * (no koa/injectkit coupling — mirrors how `@maroonedsoftware/discord` stays
 * koa-free): the consumer builds one per request from its `ServerKitContext` via
 * {@link createMcpRequestContext} and hands it to the dispatcher.
 *
 * The dispatcher stores this in an {@link https://nodejs.org/api/async_context.html | AsyncLocalStorage}
 * ({@link mcpContext}) for the duration of a call, so the singleton request
 * handlers registered on the SDK `Server` can read it without closing over any
 * one request — this is what lets a single set of handler functions serve
 * concurrent requests safely.
 */
export interface McpRequestContext {
  /** Correlation/request id (typically `ctx.requestId`). */
  requestId: string;
  /** Request-scoped logger (typically `ctx.logger`). */
  logger: Logger;
  /** Authenticated subject, if resolved by the auth policy. */
  auth?: McpAuthInfo;
  /** Derive the {@link McpToolContext} for a specific tool invocation. */
  forTool(toolName: string, signal?: AbortSignal): McpToolContext;
  /** Derive the {@link McpResourceContext} for a specific resource read. */
  forResource(uri: string, signal?: AbortSignal): McpResourceContext;
}

/**
 * AsyncLocalStorage holding the {@link McpRequestContext} for the currently
 * executing MCP call. Set by the dispatcher via `mcpContext.run(context, ...)`;
 * read by the SDK request handlers in
 * {@link import('./mcp.server.factory.js').McpServerFactory}. Handlers never
 * touch this directly — they receive a derived {@link McpToolContext} /
 * {@link McpResourceContext}.
 */
export const mcpContext = new AsyncLocalStorage<McpRequestContext>();

/** Fields needed to build an {@link McpRequestContext}. */
export type CreateMcpRequestContextInput = {
  requestId: string;
  logger: Logger;
  auth?: McpAuthInfo;
};

/**
 * Builds an {@link McpRequestContext} from request-scoped values. Call this in
 * your koa route from `ctx` (e.g. `{ requestId: ctx.requestId, logger: ctx.logger }`)
 * and pass the result to the dispatcher.
 *
 * @example
 * ```ts
 * const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger });
 * const response = await ctx.container.get(McpDispatcher).dispatch(JSON.parse(ctx.rawBody), context);
 * ```
 */
export const createMcpRequestContext = (input: CreateMcpRequestContextInput): McpRequestContext => {
  const { requestId, logger, auth } = input;
  return {
    requestId,
    logger,
    auth,
    forTool: (toolName, signal) => ({ requestId, logger, auth, toolName, signal }),
    forResource: (uri, signal) => ({ requestId, logger, auth, uri, signal }),
  };
};
