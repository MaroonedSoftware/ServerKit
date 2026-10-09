import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type GetPromptRequest,
  type GetPromptResult,
  type ListPromptsResult,
  type ListResourcesResult,
  type ListToolsResult,
  type ReadResourceRequest,
  type ReadResourceResult,
  type ServerNotification,
  type ServerRequest,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { McpConfig, MCP_DEFAULT_REQUEST_TIMEOUT_MS } from './mcp.config.js';
import { McpError } from './mcp.error.js';
import { McpToolHandlerMap } from './mcp.tool.handler.js';
import { McpResourceHandlerMap } from './mcp.resource.handler.js';
import { McpPromptHandlerMap } from './mcp.prompt.handler.js';
import { mcpContext } from './mcp.request.context.js';
import { getMcpUiToolMeta, isMcpUiAppOnlyTool, mcpUiSupport, MCP_UI_EXTENSION, MCP_UI_MIME_TYPE } from './mcp.ui.js';

/** Per-request extras the SDK passes to a `Server` request handler. */
type McpHandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** A tool definition without `_meta.ui`, dropping `_meta` entirely when nothing else is in it. */
const withoutMcpUi = (tool: Tool): Tool => {
  if (!tool._meta || !('ui' in tool._meta)) return tool;
  const { _meta, ...rest } = tool;
  const meta = Object.fromEntries(Object.entries(_meta).filter(([key]) => key !== 'ui'));
  return Object.keys(meta).length > 0 ? { ...rest, _meta: meta } : rest;
};

/**
 * Builds SDK `Server` instances wired to ServerKit's DI-registered handler maps.
 *
 * This is the seam that makes the official SDK fit ServerKit's patterns. The SDK
 * `Server` is **connection-scoped** (it stores its transport and per-connection
 * `initialize` state), so it can't be a shared singleton across concurrent HTTP
 * requests — a fresh one is needed per connection. To keep that cheap:
 *
 * - The `tools/list`, `resources/list` and `prompts/list` payloads are derived **once** here (the
 *   handler maps are frozen at bootstrap), not per request.
 * - The request-handler callbacks are **stable** instance methods, not
 *   per-request closures. They read the request-scoped
 *   {@link import('./mcp.request.context.js').McpRequestContext} from
 *   {@link mcpContext} (AsyncLocalStorage), so one set of functions serves every
 *   concurrent request without capturing any of them.
 *
 * The net cost of {@link McpServerFactory.create} is a thin `Server` shell plus
 * up to six `Map.set` registrations — on par with the per-request objects koa already
 * allocates.
 */
@Injectable()
export class McpServerFactory {
  /** Memoized `tools/list` result — the handler maps don't change after bootstrap. */
  private readonly toolList: ListToolsResult;
  /** Memoized `resources/list` result. */
  private readonly resourceList: ListResourcesResult;
  /** Memoized `prompts/list` result. */
  private readonly promptList: ListPromptsResult;
  /** `tools/list` for a client that did not negotiate MCP UI: no app-only tools, no `_meta.ui`. */
  private readonly toolListWithoutUi: ListToolsResult;
  /** `resources/list` for a client that did not negotiate MCP UI: no MCP Apps resources. */
  private readonly resourceListWithoutUi: ListResourcesResult;
  /** Whether any tool or resource carries MCP UI, so `initialize` advertises the extension. */
  private readonly hasUi: boolean;

  constructor(
    private readonly tools: McpToolHandlerMap,
    private readonly resources: McpResourceHandlerMap,
    private readonly prompts: McpPromptHandlerMap,
    private readonly config: McpConfig,
    private readonly logger: Logger,
  ) {
    this.toolList = { tools: [...tools.values()].map(handler => handler.definition) };
    this.resourceList = { resources: [...resources.values()].map(handler => handler.definition) };
    this.promptList = { prompts: [...prompts.values()].map(handler => handler.definition) };

    this.toolListWithoutUi = { tools: this.toolList.tools.filter(tool => !isMcpUiAppOnlyTool(tool)).map(withoutMcpUi) };
    this.resourceListWithoutUi = { resources: this.resourceList.resources.filter(resource => resource.mimeType !== MCP_UI_MIME_TYPE) };
    this.hasUi =
      this.toolList.tools.some(tool => getMcpUiToolMeta(tool) !== undefined) ||
      this.resourceListWithoutUi.resources.length < this.resourceList.resources.length;
  }

  /**
   * Whether this request's client is known not to render MCP UI. Only a stateful
   * session knows; an unknown client gets the full listings, since a UI host
   * needs app-only tools listed to enforce their visibility.
   */
  private hidesUi(): boolean {
    const context = mcpContext.getStore();
    return context !== undefined && mcpUiSupport(context) === 'unsupported';
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

  private readonly onListTools = async (): Promise<ListToolsResult> => (this.hidesUi() ? this.toolListWithoutUi : this.toolList);

  private readonly onListResources = async (): Promise<ListResourcesResult> => (this.hidesUi() ? this.resourceListWithoutUi : this.resourceList);

  private readonly onListPrompts = async (): Promise<ListPromptsResult> => this.promptList;

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

  private readonly onGetPrompt = async (request: GetPromptRequest, extra: McpHandlerExtra): Promise<GetPromptResult> => {
    const context = mcpContext.getStore();
    if (!context) throw new McpError('MCP prompt requested outside a request context');

    const name = request.params.name;
    const handler = this.prompts.get(name);
    if (!handler) {
      this.logger.debug('No MCP prompt handler registered', { prompt: name });
      throw new McpError(`No MCP prompt registered for "${name}"`).withInternalDetails({ prompt: name });
    }

    return handler.get(request.params.arguments ?? {}, context.forPrompt(name, this.requestSignal(extra)));
  };

  /**
   * Create a fresh `Server` with the stable request handlers attached. One per
   * connection: per request in stateless mode, per session in stateful mode.
   *
   * Advertises only the capabilities backed by a non-empty handler map, so a
   * tools-only server doesn't claim resource or prompt support. The MCP UI
   * extension is advertised only when a tool or resource carries UI.
   *
   * @param instructions - Text for the `initialize` result. Defaults to
   *   {@link McpConfig.instructions}; omitted from `initialize` when blank.
   */
  create(instructions: string | undefined = this.config.instructions): Server {
    const server = new Server(
      { name: this.config.serverName, version: this.config.version },
      {
        capabilities: {
          ...(this.tools.size > 0 ? { tools: {} } : {}),
          ...(this.resources.size > 0 ? { resources: {} } : {}),
          ...(this.prompts.size > 0 ? { prompts: {} } : {}),
          ...(this.hasUi ? { extensions: { [MCP_UI_EXTENSION]: {} } } : {}),
        },
        ...(instructions ? { instructions } : {}),
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
    if (this.prompts.size > 0) {
      server.setRequestHandler(ListPromptsRequestSchema, this.onListPrompts);
      server.setRequestHandler(GetPromptRequestSchema, this.onGetPrompt);
    }

    return server;
  }
}
