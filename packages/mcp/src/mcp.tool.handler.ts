import { Injectable } from 'injectkit';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpToolContext } from './mcp.request.context.js';

/**
 * Handler for one MCP tool, keyed in {@link McpToolHandlerMap} by its tool name
 * (`definition.name`). Analogous to `DiscordInteractionHandler` — a single
 * `handle(args, context)` method plus the metadata used to advertise the tool.
 *
 * Handlers are `@Injectable()` classes resolved from the DI container at
 * bootstrap and registered into the map; the dispatcher looks one up per
 * `tools/call` and invokes it with the request-scoped {@link McpToolContext}.
 */
export interface McpToolHandler {
  /**
   * Tool advertisement returned verbatim in `tools/list` (name, description,
   * `inputSchema` as JSON Schema). The dispatcher memoizes the list of these at
   * construction, so keep `definition` a stable value.
   */
  readonly definition: Tool;

  /**
   * Execute the tool. `args` is the raw `params.arguments` object from the
   * `tools/call` request — validate it against `definition.inputSchema` (e.g.
   * with zod/ajv) before use. Return an MCP {@link CallToolResult}; throw to
   * surface a JSON-RPC error (the SDK serializes it), or set `isError: true` on
   * the result for a tool-level failure the model can see.
   */
  handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult>;
}

/**
 * Injectable map of tool name → {@link McpToolHandler}. Register handlers under
 * their `definition.name`:
 *
 * @example
 * ```ts
 * const tools = new McpToolHandlerMap();
 * tools.set('search_docs', container.get(SearchDocsTool));
 * tools.set('create_ticket', container.get(CreateTicketTool));
 * container.register(McpToolHandlerMap, { useValue: tools });
 * ```
 */
@Injectable()
export class McpToolHandlerMap extends Map<string, McpToolHandler> {}
