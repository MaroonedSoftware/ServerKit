import { Injectable } from 'injectkit';
import type { ReadResourceResult, Resource } from '@modelcontextprotocol/sdk/types.js';
import type { McpResourceContext } from './mcp.request.context.js';

/**
 * Handler for one MCP resource, keyed in {@link McpResourceHandlerMap} by its
 * URI (`definition.uri`). Mirrors {@link import('./mcp.tool.handler.js').McpToolHandler}
 * for the `resources/list` + `resources/read` half of the protocol.
 *
 * The scaffold routes reads by exact URI. For templated/dynamic resources
 * (`resources/templates`), extend the factory to match `uri` against a template
 * set instead of a `Map.get`.
 */
export interface McpResourceHandler {
  /** Resource advertisement returned in `resources/list` (uri, name, mimeType…). */
  readonly definition: Resource;

  /**
   * Read the resource. Return an MCP {@link ReadResourceResult} (its `contents`
   * array carries the text/blob). Throw to surface a JSON-RPC error.
   */
  read(uri: string, context: McpResourceContext): Promise<ReadResourceResult>;
}

/**
 * Injectable map of resource URI → {@link McpResourceHandler}. Register handlers
 * under their `definition.uri`:
 *
 * @example
 * ```ts
 * const resources = new McpResourceHandlerMap();
 * resources.set('config://app', container.get(AppConfigResource));
 * container.register(McpResourceHandlerMap, { useValue: resources });
 * ```
 */
@Injectable()
export class McpResourceHandlerMap extends Map<string, McpResourceHandler> {}
