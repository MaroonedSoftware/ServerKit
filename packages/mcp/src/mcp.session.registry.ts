import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { McpServerFactory } from './mcp.server.factory.js';
import { mcpContext, type McpRequestContext } from './mcp.request.context.js';

/** A live MCP session: one SDK `Server` bound to one Streamable-HTTP transport. */
type McpSession = { server: Server; transport: StreamableHTTPServerTransport };

/** The HTTP exchange a stateful request needs — node's request/response plus the parsed body. */
export type McpStatefulExchange = {
  /** Inbound node request (koa's `ctx.req`). */
  req: IncomingMessage;
  /** Outbound node response (koa's `ctx.res`). The transport writes to it directly. */
  res: ServerResponse;
  /** Parsed JSON body (koa's parsed body / `JSON.parse(ctx.rawBody)`). */
  body: unknown;
  /** Value of the `Mcp-Session-Id` request header, if the client sent one. */
  sessionId?: string;
};

/**
 * Registry of long-lived MCP sessions for **stateful** mode. A `Server` +
 * `StreamableHTTPServerTransport` is created once per client (on the `initialize`
 * request), keyed by `Mcp-Session-Id`, and reused for every subsequent request in
 * that session. `initialize` runs once per client lifetime instead of once per
 * request, and the persistent connection can stream SSE and push server→client
 * messages — the capabilities stateless mode can't offer.
 *
 * The tradeoff is session affinity: a session lives in one process's memory, so
 * requests must route back to the same node. This in-memory `Map` assumes that.
 * For multi-node deployments, front it with sticky routing, or externalize
 * session/event state (the SDK's `eventStore` option, backed by your optional
 * `@maroonedsoftware/cache` peer) so any node can resume a session.
 */
@Injectable()
export class McpSessionRegistry {
  private readonly sessions = new Map<string, McpSession>();

  constructor(
    private readonly factory: McpServerFactory,
    private readonly logger: Logger,
  ) {}

  /**
   * Handle one stateful request. Reuses the session named by `Mcp-Session-Id`,
   * or opens a new one when the request is an `initialize`. The
   * {@link McpRequestContext} is made ambient (via {@link mcpContext}) for the
   * duration so tool/resource handlers see request-scoped state, exactly as in
   * stateless mode.
   *
   * Writes the response (including SSE streams) directly to `exchange.res`.
   */
  async handle(exchange: McpStatefulExchange, context: McpRequestContext): Promise<void> {
    const { req, res, body, sessionId } = exchange;

    let session = sessionId ? this.sessions.get(sessionId) : undefined;

    if (!session) {
      if (!isInitializeRequest(body)) {
        // No session and not an initialize handshake → the client must initialize first.
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session; send an initialize request first.' }, id: null }));
        return;
      }
      session = await this.open();
    }

    await mcpContext.run(context, () => session.transport.handleRequest(req, res, body));
  }

  /** Opens a new session: a fresh `Server` connected to a new Streamable-HTTP transport. */
  private async open(): Promise<McpSession> {
    const server = this.factory.create();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.sessions.set(id, { server, transport });
        this.logger.debug('MCP session opened', { sessionId: id });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        this.sessions.delete(transport.sessionId);
        this.logger.debug('MCP session closed', { sessionId: transport.sessionId });
      }
    };

    await server.connect(transport);
    return { server, transport };
  }
}
