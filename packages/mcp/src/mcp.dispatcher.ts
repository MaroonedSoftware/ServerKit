import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { isJSONRPCRequest, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { McpConfig } from './mcp.config.js';
import { McpServerFactory } from './mcp.server.factory.js';
import { McpSessionRegistry, type McpStatefulExchange } from './mcp.session.registry.js';
import { KoaMcpTransport } from './mcp.transport.js';
import { mcpContext, type McpRequestContext } from './mcp.request.context.js';

/** Default per-request handler timeout (30s) when {@link McpConfig.requestTimeoutMs} is unset. */
export const MCP_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Single entry point for serving MCP over ServerKit's Koa transport. Selects the
 * session strategy from {@link McpConfig.sessionMode} (default `'stateless'`) but
 * shares one core — the same {@link McpServerFactory}, handler maps, request
 * context, and auth — across both modes. Adding stateful is additive; it does not
 * change the stateless path.
 *
 * Transport-agnostic in the ServerKit sense: the consumer's route receives the
 * request, gates it with the auth policy, builds an {@link McpRequestContext},
 * and calls {@link McpDispatcher.dispatch} (stateless) or
 * {@link McpDispatcher.dispatchStateful} (stateful).
 *
 * @example Koa route (mode selected by config)
 * ```ts
 * router.post('/mcp', requireSignature<McpAuthOptions>('mcp', { policy: MCP_AUTH_POLICY }), async (ctx) => {
 *   const dispatcher = ctx.container.get(McpDispatcher);
 *   const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger });
 *
 *   if (dispatcher.sessionMode === 'stateful') {
 *     ctx.respond = false; // hand the raw response stream to the SDK transport (SSE)
 *     await dispatcher.dispatchStateful({ req: ctx.req, res: ctx.res, body: ctx.request.body, sessionId: ctx.get('mcp-session-id') }, context);
 *     return;
 *   }
 *
 *   const response = await dispatcher.dispatch(JSON.parse(ctx.rawBody), context);
 *   if (response) ctx.body = response;
 *   else ctx.status = 202; // a notification — nothing to return
 * });
 * ```
 */
@Injectable()
export class McpDispatcher {
  constructor(
    private readonly factory: McpServerFactory,
    private readonly sessions: McpSessionRegistry,
    private readonly config: McpConfig,
    private readonly logger: Logger,
  ) {}

  /** Resolved session strategy — `'stateless'` unless the config opts into `'stateful'`. */
  get sessionMode(): 'stateless' | 'stateful' {
    return this.config.sessionMode ?? 'stateless';
  }

  /**
   * Stateless dispatch: run one JSON-RPC message through an ephemeral `Server`
   * and return its response. Returns `undefined` for a notification (no `id`,
   * nothing to serialize) — the caller acks with an empty 202.
   *
   * The {@link McpRequestContext} is made ambient via {@link mcpContext} for the
   * duration of the call so the factory's stable handlers resolve it.
   */
  async dispatch(message: JSONRPCMessage, context: McpRequestContext): Promise<JSONRPCMessage | undefined> {
    const expectsResponse = isJSONRPCRequest(message);

    return mcpContext.run(context, async () => {
      const server = this.factory.create();
      const transport = new KoaMcpTransport();
      await server.connect(transport);

      const responsePromise = transport.response();
      transport.receive(message);

      const response = expectsResponse ? await responsePromise : undefined;
      await server.close();
      return response;
    });
  }

  /**
   * Stateful dispatch: delegate to {@link McpSessionRegistry}, which reuses (or
   * opens) a session keyed by `Mcp-Session-Id` and writes the response — SSE
   * included — directly to `exchange.res`. Only valid when
   * {@link McpDispatcher.sessionMode} is `'stateful'`.
   */
  async dispatchStateful(exchange: McpStatefulExchange, context: McpRequestContext): Promise<void> {
    if (this.sessionMode !== 'stateful') {
      this.logger.warn('dispatchStateful called while sessionMode is not "stateful"; check your route wiring');
    }
    await this.sessions.handle(exchange, context);
  }
}
