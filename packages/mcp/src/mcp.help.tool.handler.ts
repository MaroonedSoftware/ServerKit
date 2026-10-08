import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { resolveMcpInstructions, type McpInstructions } from './mcp.instructions.js';
import type { McpToolContext } from './mcp.request.context.js';
import type { McpToolHandler, McpToolHandlerMap } from './mcp.tool.handler.js';
import type { McpPromptHandlerMap } from './mcp.prompt.handler.js';

/** {@link McpHelpToolOptions.name} when the app does not choose one. */
export const MCP_DEFAULT_HELP_TOOL_NAME = 'help' as const;

/** {@link McpHelpToolOptions.description} when the app does not supply one. */
export const MCP_DEFAULT_HELP_TOOL_DESCRIPTION =
  'Explains what this server can do and lists its tools and prompts. Call it when the user asks what you can help with or how to get started.';

/** Options for {@link McpHelpToolHandler}. */
export interface McpHelpToolOptions {
  /**
   * The map the help tool is registered in. Read on the first call, once
   * bootstrap has finished filling it, to list the other tools.
   */
  tools: McpToolHandlerMap;
  /** Prompts to list after the tools, so the model can point the user at them. */
  prompts?: McpPromptHandlerMap;
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
 * every other registered tool, and any prompts, with their descriptions.
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
  private readonly prompts?: McpPromptHandlerMap;
  private readonly overview?: McpInstructions;
  /** The tool and prompt lists, built on the first call rather than at construction, when the map is still being filled. */
  private catalog?: string;

  constructor(options: McpHelpToolOptions) {
    this.tools = options.tools;
    this.prompts = options.prompts;
    this.overview = options.overview;
    this.definition = {
      name: options.name ?? MCP_DEFAULT_HELP_TOOL_NAME,
      description: options.description ?? MCP_DEFAULT_HELP_TOOL_DESCRIPTION,
      inputSchema: { type: 'object', properties: {} },
    };
  }

  async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
    const overview = await resolveMcpInstructions(this.overview, context);
    const text = [overview, this.listCatalog()].filter(Boolean).join('\n\n');
    return { content: [{ type: 'text', text }] };
  }

  private listCatalog(): string {
    if (this.catalog === undefined) {
      // By name rather than identity: `explainToolErrors` registers a wrapper, not this instance.
      const tools = [...this.tools.values()].map(handler => handler.definition).filter(tool => tool.name !== this.definition.name);
      const prompts = [...(this.prompts?.values() ?? [])].map(handler => handler.definition);
      this.catalog = [section('Tools:', tools), section('Prompts:', prompts)].filter(Boolean).join('\n\n');
    }
    return this.catalog;
  }
}

/** A titled bullet list of names and descriptions, or `''` when there is nothing to list. */
const section = (title: string, entries: { name: string; description?: string }[]): string =>
  entries.length === 0
    ? ''
    : [title, ...entries.map(entry => (entry.description ? `- ${entry.name}: ${entry.description}` : `- ${entry.name}`))].join('\n');
