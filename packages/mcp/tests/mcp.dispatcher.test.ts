import { describe, it, expect, vi } from 'vitest';
import type { CallToolResult, JSONRPCMessage, ReadResourceResult, Resource, Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpDispatcher } from '../src/mcp.dispatcher.js';
import { McpServerFactory } from '../src/mcp.server.factory.js';
import { McpSessionRegistry } from '../src/mcp.session.registry.js';
import { McpToolHandlerMap, type McpToolHandler } from '../src/mcp.tool.handler.js';
import { requireMcpAuthenticationSession } from '../src/mcp.authentication.session.js';
import { McpResourceHandlerMap, type McpResourceHandler } from '../src/mcp.resource.handler.js';
import type { McpConfig } from '../src/mcp.config.js';
import type { McpResourceContext, McpToolContext } from '../src/mcp.request.context.js';
import { makeAuthenticatedSession, makeContext, makeLogger } from './helpers.js';

/**
 * What a handler saw at invocation time. The dispatcher closes the SDK `Server`
 * once a response is produced, and closing aborts every in-flight request
 * signal — so `aborted` has to be sampled inside the handler, not after
 * `dispatch` resolves.
 */
type Seen = { args: Record<string, unknown>; context: McpToolContext; aborted: boolean };

const echoTool = () => {
  const seen: Seen[] = [];
  const handler: McpToolHandler = {
    definition: {
      name: 'echo',
      description: 'Echo the input message back.',
      inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    } satisfies Tool,
    handle: vi.fn(async (args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> => {
      seen.push({ args, context, aborted: context.signal?.aborted ?? false });
      return { content: [{ type: 'text', text: `${context.toolName}:${String(args.message)}` }] };
    }),
  };
  return { handler, seen };
};

/** A tool that enforces an authenticated session, the shape generated code uses. */
const guardedTool = (): McpToolHandler => ({
  definition: {
    name: 'guarded',
    description: 'Requires an authenticated session.',
    inputSchema: { type: 'object', properties: {} },
  } satisfies Tool,
  handle: vi.fn(async (_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> => {
    const session = requireMcpAuthenticationSession(context);
    return { content: [{ type: 'text', text: session.subject }] };
  }),
});

/** A tool that only settles when its signal aborts — the shape a timeout must cancel. */
const slowTool = () => {
  const seen: McpToolContext[] = [];
  const handler: McpToolHandler = {
    definition: { name: 'slow', description: 'Waits for cancellation.', inputSchema: { type: 'object', properties: {} } } satisfies Tool,
    handle: (_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> => {
      seen.push(context);
      return new Promise((_resolve, reject) => {
        context.signal?.addEventListener('abort', () => reject(context.signal?.reason), { once: true });
      });
    },
  };
  return { handler, seen };
};

const appResource = () => {
  const seen: McpResourceContext[] = [];
  const handler: McpResourceHandler = {
    definition: { uri: 'config://app', name: 'app config' } satisfies Resource,
    read: async (uri: string, context: McpResourceContext): Promise<ReadResourceResult> => {
      seen.push(context);
      return { contents: [{ uri, text: 'ok' }] };
    },
  };
  return { handler, seen };
};

const buildDispatcher = (mode: McpConfig['sessionMode'] = 'stateless', requestTimeoutMs?: number) => {
  const tools = new McpToolHandlerMap();
  const echo = echoTool();
  tools.set('echo', echo.handler);
  tools.set('guarded', guardedTool());
  const slow = slowTool();
  tools.set('slow', slow.handler);
  const resources = new McpResourceHandlerMap();
  const resource = appResource();
  resources.set('config://app', resource.handler);
  const config: McpConfig = { serverName: 'test', version: '0.0.0', sessionMode: mode, requestTimeoutMs };
  const logger = makeLogger();
  const factory = new McpServerFactory(tools, resources, config, logger);
  const registry = new McpSessionRegistry(factory, logger);
  return { dispatcher: new McpDispatcher(factory, registry, config, logger), echo, slow, resource };
};

const rpc = (id: number, method: string, params?: Record<string, unknown>): JSONRPCMessage => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params ? { params } : {}),
});

describe('McpDispatcher (stateless)', () => {
  it('defaults to stateless mode', () => {
    expect(buildDispatcher(undefined).dispatcher.sessionMode).toBe('stateless');
  });

  it('lists registered tools from the memoized advertisement', async () => {
    const { dispatcher } = buildDispatcher();
    const response = await dispatcher.dispatch(rpc(1, 'tools/list'), makeContext());
    expect(response).toMatchObject({ id: 1, result: { tools: [{ name: 'echo' }, { name: 'guarded' }, { name: 'slow' }] } });
  });

  it('routes a tools/call to the registered handler with a per-request context', async () => {
    const { dispatcher, echo } = buildDispatcher();
    const response = await dispatcher.dispatch(rpc(2, 'tools/call', { name: 'echo', arguments: { message: 'hi' } }), makeContext());
    expect(response).toMatchObject({ id: 2, result: { content: [{ type: 'text', text: 'echo:hi' }] } });
    expect(echo.seen[0]?.args).toEqual({ message: 'hi' });
    expect(echo.seen[0]?.context).toMatchObject({ toolName: 'echo', requestId: 'req-1' });
  });

  it('carries the authentication session through AsyncLocalStorage to the handler', async () => {
    const { dispatcher, echo } = buildDispatcher();
    const authenticationSession = makeAuthenticatedSession();
    await dispatcher.dispatch(rpc(6, 'tools/call', { name: 'echo', arguments: { message: 'hi' } }), makeContext({ authenticationSession }));
    expect(echo.seen[0]?.context.authenticationSession).toBe(authenticationSession);
  });

  it('surfaces a handler session check as a JSON-RPC error when no session is present', async () => {
    const { dispatcher } = buildDispatcher();
    const response = (await dispatcher.dispatch(rpc(7, 'tools/call', { name: 'guarded', arguments: {} }), makeContext())) as { error?: unknown };
    expect(response.error).toBeDefined();
  });

  it('lets a guarded handler through when the context carries a session', async () => {
    const { dispatcher } = buildDispatcher();
    const response = await dispatcher.dispatch(
      rpc(8, 'tools/call', { name: 'guarded', arguments: {} }),
      makeContext({ authenticationSession: makeAuthenticatedSession() }),
    );
    expect(response).toMatchObject({ id: 8, result: { content: [{ type: 'text', text: 'user-1' }] } });
  });

  it('errors when calling an unregistered tool', async () => {
    const { dispatcher } = buildDispatcher();
    const response = (await dispatcher.dispatch(rpc(3, 'tools/call', { name: 'nope', arguments: {} }), makeContext())) as { error?: unknown };
    expect(response.error).toBeDefined();
  });

  it('hands the tool a live abort signal that is not yet aborted', async () => {
    const { dispatcher, echo } = buildDispatcher();
    await dispatcher.dispatch(rpc(9, 'tools/call', { name: 'echo', arguments: { message: 'hi' } }), makeContext());
    expect(echo.seen[0]?.context.signal).toBeInstanceOf(AbortSignal);
    expect(echo.seen[0]?.aborted).toBe(false);
  });

  it('hands a resource read a signal too', async () => {
    const { dispatcher, resource } = buildDispatcher();
    await dispatcher.dispatch(rpc(10, 'resources/read', { uri: 'config://app' }), makeContext());
    expect(resource.seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts the handler signal once requestTimeoutMs elapses', async () => {
    const { dispatcher, slow } = buildDispatcher('stateless', 20);
    const response = (await dispatcher.dispatch(rpc(11, 'tools/call', { name: 'slow', arguments: {} }), makeContext())) as { error?: unknown };
    expect(response.error).toBeDefined();
    expect(slow.seen[0]?.signal?.aborted).toBe(true);
  });

  it('isolates concurrent requests via AsyncLocalStorage', async () => {
    const { dispatcher } = buildDispatcher();
    const [a, b] = await Promise.all([
      dispatcher.dispatch(rpc(4, 'tools/call', { name: 'echo', arguments: { message: 'A' } }), makeContext()),
      dispatcher.dispatch(rpc(5, 'tools/call', { name: 'echo', arguments: { message: 'B' } }), makeContext()),
    ]);
    expect(a).toMatchObject({ id: 4, result: { content: [{ type: 'text', text: 'echo:A' }] } });
    expect(b).toMatchObject({ id: 5, result: { content: [{ type: 'text', text: 'echo:B' }] } });
  });
});
