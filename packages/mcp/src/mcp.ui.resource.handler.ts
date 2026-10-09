import type { ReadResourceResult, Resource } from '@modelcontextprotocol/sdk/types.js';
import type { McpResourceContext } from './mcp.request.context.js';
import type { McpResourceHandler } from './mcp.resource.handler.js';
import { assertMcpUiUri, MCP_UI_MIME_TYPE, type McpUiResourceMeta } from './mcp.ui.js';

/** Options for an {@link McpUiResource}. */
export interface McpUiResourceOptions {
  /** The `ui://` URI tools point at through `_meta.ui.resourceUri`. */
  uri: string;
  /** Programmatic name advertised in `resources/list`. */
  name: string;
  /** Human-readable title. */
  title?: string;
  /** What the app shows. */
  description?: string;
  /** CSP, permissions, domain, and border preference for the app iframe. */
  ui?: McpUiResourceMeta;
}

/**
 * Base class for an MCP Apps resource: the HTML a host renders in a sandboxed
 * iframe for a tool whose definition points at it (see
 * {@link import('./mcp.ui.js').withMcpUi}). Subclasses supply the document from
 * {@link McpUiResource.html}; the base advertises it with the MCP Apps MIME
 * type and puts `_meta.ui` on both the listing and the read contents, since
 * hosts differ in which one they read.
 *
 * Register it in {@link import('./mcp.resource.handler.js').McpResourceHandlerMap}
 * under its URI like any other resource.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class MetricChartApp extends McpUiResource {
 *   constructor() {
 *     super({ uri: 'ui://charts/metric', name: 'metric_chart', ui: { csp: { resourceDomains: ['https://cdn.example.com'] } } });
 *   }
 *
 *   protected async html(): Promise<string> {
 *     return chartAppHtml; // a bundled single-file app
 *   }
 * }
 * ```
 */
export abstract class McpUiResource implements McpResourceHandler {
  readonly definition: Resource;

  private readonly ui?: McpUiResourceMeta;

  /** @throws McpError when `options.uri` does not use the `ui://` scheme. */
  protected constructor(options: McpUiResourceOptions) {
    assertMcpUiUri(options.uri);
    const { uri, name, title, description, ui } = options;
    this.ui = ui;
    this.definition = {
      uri,
      name,
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      mimeType: MCP_UI_MIME_TYPE,
      ...(ui !== undefined ? { _meta: { ui } } : {}),
    };
  }

  /**
   * The app's HTML document. Hosts load it into a sandboxed iframe, so it should
   * be self-contained or load only from origins listed in `ui.csp`.
   */
  protected abstract html(context: McpResourceContext): Promise<string>;

  async read(uri: string, context: McpResourceContext): Promise<ReadResourceResult> {
    const text = await this.html(context);
    return { contents: [{ uri, mimeType: MCP_UI_MIME_TYPE, text, ...(this.ui !== undefined ? { _meta: { ui: this.ui } } : {}) }] };
  }
}
