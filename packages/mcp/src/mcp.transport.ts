import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * A minimal, single-exchange {@link Transport} for **stateless** MCP over HTTP.
 *
 * The SDK's `Transport` contract is tiny — `start`/`send`/`close` plus the
 * `onmessage`/`onclose`/`onerror` callbacks the connected `Server` assigns. This
 * bridge implements it against one request/response pair instead of a socket:
 * {@link receive} feeds the inbound JSON-RPC message to the server; the first
 * outbound {@link send} is captured and exposed via {@link response}. That maps a
 * single POST to a single JSON body — exactly the "return a response the route
 * serializes" shape ServerKit's dispatchers already use.
 *
 * For streaming / server-initiated messages, use stateful mode (the SDK's own
 * `StreamableHTTPServerTransport`, driven by
 * {@link import('./mcp.session.registry.js').McpSessionRegistry}) instead — this
 * transport intentionally handles only the one-shot case.
 */
export class KoaMcpTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  sessionId?: string;

  private captured?: JSONRPCMessage;
  private resolveResponse!: (message: JSONRPCMessage) => void;
  private readonly responsePromise = new Promise<JSONRPCMessage>((resolve) => {
    this.resolveResponse = resolve;
  });

  async start(): Promise<void> {
    // Nothing to open — messages are pushed in via `receive`.
  }

  async send(message: JSONRPCMessage): Promise<void> {
    // A single stateless request yields exactly one response; capture the first.
    if (this.captured === undefined) {
      this.captured = message;
      this.resolveResponse(message);
    }
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  /** Feed the parsed inbound JSON-RPC message to the connected `Server`. */
  receive(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }

  /** Resolves with the single JSON-RPC response the server produced for the request. */
  response(): Promise<JSONRPCMessage> {
    return this.responsePromise;
  }
}
