import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpError } from './mcp.error.js';

/**
 * Extension identifier for MCP Apps (spec 2026-01-26). A client that can render
 * app UIs advertises it under `capabilities.extensions` in `initialize`.
 */
export const MCP_UI_EXTENSION = 'io.modelcontextprotocol/ui';

/** MIME type of an MCP Apps HTML resource. Hosts render only resources with this type. */
export const MCP_UI_MIME_TYPE = 'text/html;profile=mcp-app';

/** URI scheme every MCP Apps resource uses. */
export const MCP_UI_URI_SCHEME = 'ui://';

/**
 * Who may call a UI-linked tool. `'model'` puts it in the agent's tool list;
 * `'app'` lets the rendered app call it. Omitted means both.
 */
export type McpUiVisibility = 'model' | 'app';

/** The `_meta.ui` block on a tool definition. */
export interface McpUiToolMeta {
  /** The `ui://` resource the host renders for this tool's results. */
  resourceUri?: string;
  /** Who may call the tool. Defaults to `['model', 'app']` when omitted. */
  visibility?: McpUiVisibility[];
}

/**
 * Origins the app iframe may reach. Omitting `csp` gives the host's restrictive
 * defaults, so list only what the app actually loads.
 */
export interface McpUiCsp {
  /** Origins for `fetch`, XHR, and WebSocket (`connect-src`). */
  connectDomains?: string[];
  /** Origins for scripts, styles, images, fonts, and media. */
  resourceDomains?: string[];
  /** Origins the app may embed in nested frames (`frame-src`). */
  frameDomains?: string[];
  /** Origins allowed as the document base URI (`base-uri`). */
  baseUriDomains?: string[];
}

/** Browser permissions the app requests. Each present key is a request; the value is an empty object. */
export interface McpUiPermissions {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
}

/** The `_meta.ui` block on an MCP Apps resource. */
export interface McpUiResourceMeta {
  /** Content security policy for the app iframe. */
  csp?: McpUiCsp;
  /** Browser permissions the app requests. */
  permissions?: McpUiPermissions;
  /** Dedicated origin for the app. The format is host-dependent. */
  domain?: string;
  /** Whether the host should draw a border around the app. Omit to let the host decide. */
  prefersBorder?: boolean;
}

/** What a client advertises under `capabilities.extensions[MCP_UI_EXTENSION]`. */
export interface McpUiClientCapability {
  /** UI resource MIME types the client can render. */
  mimeTypes: string[];
}

/** Throws unless `uri` uses the {@link MCP_UI_URI_SCHEME}. */
export const assertMcpUiUri = (uri: string): void => {
  if (!uri.startsWith(MCP_UI_URI_SCHEME)) {
    throw new McpError(`MCP UI resource URIs must use the ${MCP_UI_URI_SCHEME} scheme`).withDetails({ uri });
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Returns a copy of `tool` with `ui` merged into `_meta.ui`. Other `_meta` keys
 * are kept, and fields already under `_meta.ui` are overridden only where `ui`
 * sets them. Emits only the nested form, never the deprecated flat
 * `_meta["ui/resourceUri"]` key.
 *
 * @throws McpError when `ui.resourceUri` does not use the `ui://` scheme.
 *
 * @example
 * ```ts
 * readonly definition = withMcpUi(
 *   { name: 'show_chart', description: 'Chart a metric.', inputSchema: { type: 'object', properties: {} } },
 *   { resourceUri: 'ui://charts/metric' },
 * );
 * ```
 */
export const withMcpUi = (tool: Tool, ui: McpUiToolMeta): Tool => {
  if (ui.resourceUri !== undefined) assertMcpUiUri(ui.resourceUri);
  const existing = getMcpUiToolMeta(tool) ?? {};
  return { ...tool, _meta: { ...tool._meta, ui: { ...existing, ...ui } } };
};

/** Reads `_meta.ui` from a tool definition, or `undefined` when it has none. */
export const getMcpUiToolMeta = (tool: Tool): McpUiToolMeta | undefined => {
  const ui = tool._meta?.ui;
  return isRecord(ui) ? (ui as McpUiToolMeta) : undefined;
};

/**
 * Whether a tool is callable only by the rendered app: its visibility is set
 * and leaves out `'model'`. The host must keep such a tool out of the agent's
 * tool list.
 */
export const isMcpUiAppOnlyTool = (tool: Tool): boolean => {
  const visibility = getMcpUiToolMeta(tool)?.visibility;
  return visibility !== undefined && !visibility.includes('model');
};
