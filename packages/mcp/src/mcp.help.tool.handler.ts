import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { resolveMcpInstructions, type McpInstructions } from './mcp.instructions.js';
import type { McpToolContext } from './mcp.request.context.js';
import type { McpToolHandler, McpToolHandlerMap } from './mcp.tool.handler.js';

/** {@link McpHelpToolOptions.name} when the app does not choose one. */
export const MCP_DEFAULT_HELP_TOOL_NAME = 'help' as const;

/** {@link McpHelpToolOptions.description} when the app does not supply one. */
export const MCP_DEFAULT_HELP_TOOL_DESCRIPTION =
  'Explains what this server can do and lists its tools. Call it when the user asks what you can help with or how to get started.';

/** Options for {@link McpHelpToolHandler}. */
export interface McpHelpToolOptions {
  /**
   * The map the help tool is registered in. Read on the first call, once
   * bootstrap has finished filling it, to list the other tools.
   */
  tools: McpToolHandlerMap;
  /**
   * Text that opens the answer. Fixed text, or a function of the call's context
   * that runs on every call, so it can reflect the caller's current role. Pass
   * the same value you give the dispatcher (or `McpConfig.instructions`) to keep
   * one source of truth. `undefined` and `''` leave the answer as the tool list.
   */
  overview?: McpInstructions;
  /** Tool name. Defaults to {@link MCP_DEFAULT_HELP_TOOL_NAME}. Register the handler under the same key. */
  name?: string;
  /** Tool description the model sees. Defaults to {@link MCP_DEFAULT_HELP_TOOL_DESCRIPTION}. */
  description?: string;
}

/**
 * An opt-in tool that tells the model what the server is for: an overview, then
 * every other registered tool with its description.
 *
 * A tool is the one channel every MCP client exposes, and the model calls it on
 * its own when the user asks what it can do. That covers clients that ignore
 * server `instructions`, and, because the overview is resolved per call, it stays
 * current where `instructions` is frozen at `initialize`.
 *
 * It is an ordinary {@link McpToolHandler}, so auth, `requireMcpPolicy` and
 * `explainToolErrors` apply to it as to any tool. It lists every tool regardless
 * of who is asking, the same set `tools/list` returns.
 *
 * @example
 * ```ts
 * registry
 *   .register(McpToolHandlerMap)
 *   .useFactory(container => {
 *     const tools = new McpToolHandlerMap([['search_docs', container.get(SearchDocsTool)]]);
 *     tools.set('help', new McpHelpToolHandler({ tools, overview: container.get(McpConfig).instructions }));
 *     return tools;
 *   })
 *   .asSingleton();
 * ```
 */
export class McpHelpToolHandler implements McpToolHandler {
  readonly definition: Tool;

  private readonly tools: McpToolHandlerMap;
  private readonly overview?: McpInstructions;
  /** The tool list, built on the first call rather than at construction, when the map is still being filled. */
  private catalog?: string;

  constructor(options: McpHelpToolOptions) {
    this.tools = options.tools;
    this.overview = options.overview;
    this.definition = {
      name: options.name ?? MCP_DEFAULT_HELP_TOOL_NAME,
      description: options.description ?? MCP_DEFAULT_HELP_TOOL_DESCRIPTION,
      inputSchema: { type: 'object', properties: {} },
    };
  }

  async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
    const overview = await resolveMcpInstructions(this.overview, context);
    const text = [overview, this.listTools()].filter(Boolean).join('\n\n');
    return { content: [{ type: 'text', text }] };
  }

  private listTools(): string {
    if (this.catalog === undefined) {
      // By name rather than identity: `explainToolErrors` registers a wrapper, not this instance.
      const others = [...this.tools.values()].map(handler => handler.definition).filter(tool => tool.name !== this.definition.name);
      this.catalog =
        others.length === 0
          ? ''
          : ['Tools:', ...others.map(tool => (tool.description ? `- ${tool.name}: ${tool.description}` : `- ${tool.name}`))].join('\n');
    }
    return this.catalog;
  }
}
