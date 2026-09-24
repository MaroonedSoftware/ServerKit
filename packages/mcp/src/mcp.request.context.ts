import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthenticationSession } from '@maroonedsoftware/authentication';
import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';
import type { McpAuthInfo } from './mcp.auth.js';

/**
 * The request-scoped values every MCP context carries, whatever it is a view of.
 * {@link McpRequestContext} holds them for the request; {@link McpToolContext}
 * and {@link McpResourceContext} inherit them for one invocation.
 *
 * A new request-scoped value belongs here, not on the three types that extend
 * it. It is also the input to {@link createMcpRequestContext}, aliased as
 * {@link CreateMcpRequestContextInput}.
 */
export interface McpContextBase {
  /** Correlation/request id for this MCP call (from `ctx.requestId`). */
  requestId: string;
  /** Request-scoped logger (from `ctx.logger`). */
  logger: Logger;
  /**
   * Authenticated subject, if the auth policy resolved one.
   *
   * @deprecated Read {@link McpContextBase.authenticationSession} instead, and
   *   authenticate with
   *   {@link import('./mcp.authentication.handler.js').McpAuthenticationHandler}.
   *   This field is only ever populated by the header-reading
   *   {@link import('./mcp.auth.assert.js').assertMcpAuth} path, which cannot run
   *   behind `authenticationPlugin` / `authenticationMiddleware`.
   */
  auth?: McpAuthInfo;
  /**
   * ServerKit authentication session for the request, when the route ran the
   * authentication stack. Unrelated to the MCP transport session
   * (`Mcp-Session-Id`). Narrow it with
   * {@link import('./mcp.authentication.session.js').requireMcpAuthenticationSession}
   * before using it to evaluate a policy.
   */
  authenticationSession?: AuthenticationSession;
  /**
   * The request-scoped DI container (`ctx.container` on Koa, `request.container`
   * on Fastify), when the route supplied it. Resolve request-scoped services from
   * this, not from the root container a singleton handler was built from.
   */
  container?: Container;
}

/**
 * Per-tool view of the request context handed to an
 * {@link import('./mcp.tool.handler.js').McpToolHandler}. Everything a handler
 * needs that is request-scoped rather than singleton.
 */
export interface McpToolContext extends McpContextBase {
  /** Name of the tool being invoked. */
  toolName: string;
  /** Abort signal for the invocation (cancellation / timeout), when available. */
  signal?: AbortSignal;
}

/**
 * Per-resource view of the request context handed to an
 * {@link import('./mcp.resource.handler.js').McpResourceHandler}.
 */
export interface McpResourceContext extends McpContextBase {
  /** URI of the resource being read. */
  uri: string;
  /** Abort signal for the invocation, when available. */
  signal?: AbortSignal;
}

/**
 * Request-scoped context threaded to MCP handlers. Deliberately transport-neutral
 * (no koa or fastify coupling, mirroring how `@maroonedsoftware/discord` stays
 * koa-free): the consumer builds one per request from its `ServerKitContext` via
 * {@link createMcpRequestContext} and hands it to the dispatcher. It may carry the
 * request's injectkit container; that is DI, which this package already depends
 * on, not transport, so it does not change the neutrality.
 *
 * The dispatcher stores this in an {@link https://nodejs.org/api/async_context.html | AsyncLocalStorage}
 * ({@link mcpContext}) for the duration of a call, so the singleton request
 * handlers registered on the SDK `Server` can read it without closing over any
 * one request — this is what lets a single set of handler functions serve
 * concurrent requests safely.
 */
export interface McpRequestContext extends McpContextBase {
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

/** Fields needed to build an {@link McpRequestContext} — the shared {@link McpContextBase}. */
export type CreateMcpRequestContextInput = McpContextBase;

/**
 * Builds an {@link McpRequestContext} from request-scoped values. Call this in
 * your koa route from `ctx` and pass the result to the dispatcher. On Fastify
 * the same values come from `request.requestId`, `request.logger`,
 * `request.authenticationSession`, and `request.container`.
 *
 * @example
 * ```ts
 * const context = createMcpRequestContext({
 *   requestId: ctx.requestId,
 *   logger: ctx.logger,
 *   authenticationSession: ctx.authenticationSession,
 *   container: ctx.container,
 * });
 * const response = await ctx.container.get(McpDispatcher).dispatch(ctx.parsedBody as JSONRPCMessage, context);
 * ```
 */
export const createMcpRequestContext = (input: CreateMcpRequestContextInput): McpRequestContext => {
  const { requestId, logger, auth, authenticationSession, container } = input;

  // Destructured rather than aliasing `input`, so a caller mutating the object
  // it passed in cannot reach into a context already handed to a handler.
  const shared: McpContextBase = { requestId, logger, auth, authenticationSession, container };

  return {
    ...shared,
    forTool: (toolName, signal) => ({ ...shared, toolName, signal }),
    forResource: (uri, signal) => ({ ...shared, uri, signal }),
  };
};
