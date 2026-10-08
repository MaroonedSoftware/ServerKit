import { Injectable } from 'injectkit';
import type { GetPromptResult, Prompt } from '@modelcontextprotocol/sdk/types.js';
import type { McpPromptContext } from './mcp.request.context.js';

/**
 * Handler for one MCP prompt, keyed in {@link McpPromptHandlerMap} by its name
 * (`definition.name`). Mirrors {@link import('./mcp.tool.handler.js').McpToolHandler}
 * for the `prompts/list` + `prompts/get` half of the protocol.
 *
 * A prompt is a message template the user picks, not something the model calls:
 * clients surface prompts as slash commands or menu entries. That makes one a good
 * fit for a guided "get started" flow the user can come back to.
 */
export interface McpPromptHandler {
  /**
   * Prompt advertisement returned verbatim in `prompts/list` (name, description,
   * `arguments`). Memoized at construction, so keep it a stable value.
   */
  readonly definition: Prompt;

  /**
   * Render the prompt. `args` is the raw `params.arguments` from `prompts/get`;
   * check required arguments before use. Return an MCP {@link GetPromptResult}
   * (its `messages` are what the client inserts). Throw to surface a JSON-RPC error.
   */
  get(args: Record<string, string>, context: McpPromptContext): Promise<GetPromptResult>;
}

/**
 * Injectable map of prompt name → {@link McpPromptHandler}. Register it even
 * with no prompts, as you do the tool and resource maps:
 *
 * @example
 * ```ts
 * registry.register(WelcomePrompt).useClass(WelcomePrompt).asSingleton();
 *
 * registry.register(McpPromptHandlerMap).useMap(McpPromptHandlerMap).set('welcome', WelcomePrompt);
 * ```
 */
@Injectable()
export class McpPromptHandlerMap extends Map<string, McpPromptHandler> {}
