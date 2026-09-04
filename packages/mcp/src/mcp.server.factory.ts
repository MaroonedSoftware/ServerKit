import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type ListResourcesResult,
  type ListToolsResult,
  type ReadResourceRequest,
  type ReadResourceResult,
  type ServerNotification,
  type ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { McpConfig, MCP_DEFAULT_REQUEST_TIMEOUT_MS } from './mcp.config.js';
import { McpError } from './mcp.error.js';
import { McpToolHandlerMap } from './mcp.tool.handler.js';
import { McpResourceHandlerMap } from './mcp.resource.handler.js';
import { mcpContext } from './mcp.request.context.js';

/** Per-request extras the SDK passes to a `Server` request handler. */
type McpHandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Builds SDK `Server` instances wired to ServerKit's DI-registered handler maps.
 *
 * This is the seam that makes the official SDK fit ServerKit's patterns. The SDK
 * `Server` is **connection-scoped** (it stores its transport and per-connection
 * `initialize` state), so it can't be a shared singleton across concurrent HTTP
 * requests — a fresh one is needed per connection. To keep that cheap:
 *
 * - The `tools/list` and `resources/list` payloads are derived **once** here (the
 *   handler maps are frozen at bootstrap), not per request.
 * - The request-handler callbacks are **stable** instance methods, not
 *   per-request closures. They read the request-scoped
 *   {@link import('./mcp.request.context.js').McpRequestContext} from
 *   {@link mcpContext} (AsyncLocalStorage), so one set of functions serves every
 *   concurrent request without capturing any of them.
 *
 * The net cost of {@link McpServerFactory.create} is a thin `Server` shell plus
 * four `Map.set` registrations — on par with the per-request objects koa already
 * allocates.
 */
@Injectable()
export class McpServerFactory {
  /** Memoized `tools/list` result — the handler maps don't change after bootstrap. */
  private readonly toolList: ListToolsResult;
  /** Memoized `resources/list` result. */
  private readonly resourceList: ListResourcesResult;

  constructor(
    private readonly tools: McpToolHandlerMap,
    private readonly resources: McpResourceHandlerMap,
    private readonly config: McpConfig,
    private readonly logger: Logger,
  ) {
    this.toolList = { tools: [...tools.values()].map(handler => handler.definition) };
    this.resourceList = { resources: [...resources.values()].map(handler => handler.definition) };
  }

  /**
   * Signal handed to a handler for one invocation: the SDK's per-request abort
   * signal (client `notifications/cancelled`, connection close) combined with
   * {@link McpConfig.requestTimeoutMs}. Aborting it does not abandon the
   * handler's promise — cancellation is cooperative.
   */
  private requestSignal(extra: Pick<McpHandlerExtra, 'signal'>): AbortSignal {
    return AbortSignal.any([extra.signal, AbortSignal.timeout(this.config.requestTimeoutMs ?? MCP_DEFAULT_REQUEST_TIMEOUT_MS)]);
  }

  private readonly onListTools = async (): Promise<ListToolsResult> => this.toolList;

  private readonly onListResources = async (): Promise<ListResourcesResult> => this.resourceList;

  private readonly onCallTool = async (request: CallToolRequest, extra: McpHandlerExtra): Promise<CallToolResult> => {
    const context = mcpContext.getStore();
    if (!context) throw new McpError('MCP tool invoked outside a request context');

    const name = request.params.name;
    const handler = this.tools.get(name);
    if (!handler) {
      this.logger.debug('No MCP tool handler registered', { tool: name });
      throw new McpError(`No MCP tool registered for "${name}"`).withInternalDetails({ tool: name });
    }

    return handler.handle(request.params.arguments ?? {}, context.forTool(name, this.requestSignal(extra)));
  };

  private readonly onReadResource = async (request: ReadResourceRequest, extra: McpHandlerExtra): Promise<ReadResourceResult> => {
    const context = mcpContext.getStore();
    if (!context) throw new McpError('MCP resource read outside a request context');

    const uri = request.params.uri;
    const handler = this.resources.get(uri);
    if (!handler) {
      this.logger.debug('No MCP resource handler registered', { uri });
      throw new McpError(`No MCP resource registered for "${uri}"`).withInternalDetails({ uri });
    }

    return handler.read(uri, context.forResource(uri, this.requestSignal(extra)));
  };

  /**
   * Create a fresh `Server` with the stable request handlers attached. One per
   * connection: per request in stateless mode, per session in stateful mode.
   *
   * Advertises only the capabilities backed by a non-empty handler map, so a
   * tools-only server doesn't claim resource support.
   */
  create(): Server {
    const server = new Server(
      { name: this.config.serverName, version: this.config.version },
      {
        capabilities: {
          ...(this.tools.size > 0 ? { tools: {} } : {}),
          ...(this.resources.size > 0 ? { resources: {} } : {}),
        },
      },
    );

    if (this.tools.size > 0) {
      server.setRequestHandler(ListToolsRequestSchema, this.onListTools);
      server.setRequestHandler(CallToolRequestSchema, this.onCallTool);
    }
    if (this.resources.size > 0) {
      server.setRequestHandler(ListResourcesRequestSchema, this.onListResources);
      server.setRequestHandler(ReadResourceRequestSchema, this.onReadResource);
    }

    return server;
  }
}
