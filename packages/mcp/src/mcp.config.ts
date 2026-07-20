/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { Injectable } from 'injectkit';

/**
 * Session strategy for the MCP HTTP transport.
 *
 * - `'stateless'` — each POST is a self-contained JSON-RPC request/response. No
 *   session state, no affinity, trivially horizontally scalable. Cannot push
 *   server-initiated messages (progress, notifications, sampling). **Default.**
 * - `'stateful'` — a `Server` + Streamable-HTTP transport is kept alive per
 *   `Mcp-Session-Id` and reused across the session's requests, enabling SSE
 *   streaming and server→client messages at the cost of session affinity and
 *   eviction. See {@link import('./mcp.session.registry.js').McpSessionRegistry}.
 */
export type McpSessionMode = 'stateless' | 'stateful';

/**
 * Configuration for the MCP package. Declared as an abstract `@Injectable()`
 * class so it doubles as a DI token (mirrors the `Logger` pattern in
 * `@maroonedsoftware/logger` and `DiscordConfig` in `@maroonedsoftware/discord`).
 *
 * Consumers register a concrete value at bootstrap, typically resolved from
 * `AppConfig`:
 *
 * ```ts
 * const mcpConfig = appConfig.getAs<McpConfig>('mcp');
 * container.register(McpConfig, { useValue: mcpConfig });
 * ```
 *
 * Services in this package take `McpConfig` directly in their constructor.
 */
export interface McpConfig {
  /** Server name advertised to clients during `initialize` (MCP `serverInfo.name`). */
  serverName: string;
  /** Server version advertised to clients during `initialize` (MCP `serverInfo.version`). */
  version: string;
  /**
   * Session strategy for the HTTP transport. Defaults to `'stateless'` when
   * omitted — see {@link McpSessionMode}.
   */
  sessionMode?: McpSessionMode;
  /**
   * Shared bearer token accepted by the bundled {@link import('./mcp.auth.policy.js').McpAuthPolicy}.
   *
   * This is a **scaffold-grade** auth seam: a single static token compared in
   * constant time. Production MCP servers act as OAuth 2.0 resource servers and
   * validate a JWT access token against an authorization server — swap
   * {@link import('./mcp.auth.js').verifyMcpBearer} (or subclass the policy) for
   * that when you wire real auth. Leave unset to run the endpoint unauthenticated
   * (development only).
   */
  bearerToken?: string;
  /**
   * Per-request timeout (in milliseconds) applied to a tool/resource handler
   * invocation. Defaults to {@link import('./mcp.dispatcher.js').MCP_DEFAULT_REQUEST_TIMEOUT_MS} (30s).
   */
  requestTimeoutMs?: number;
}

@Injectable()
export abstract class McpConfig implements McpConfig {}
