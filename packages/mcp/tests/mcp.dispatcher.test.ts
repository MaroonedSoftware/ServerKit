import { describe, it, expect, vi } from 'vitest';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpDispatcher } from '../src/mcp.dispatcher.js';
import { McpServerFactory } from '../src/mcp.server.factory.js';
import { McpSessionRegistry } from '../src/mcp.session.registry.js';
import { McpToolHandlerMap, type McpToolHandler } from '../src/mcp.tool.handler.js';
import { McpResourceHandlerMap } from '../src/mcp.resource.handler.js';
import type { McpConfig } from '../src/mcp.config.js';
import type { McpToolContext } from '../src/mcp.request.context.js';
import { makeContext, makeLogger } from './helpers.js';

const echoTool = (): McpToolHandler => ({
  definition: {
    name: 'echo',
    description: 'Echo the input message back.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  } satisfies Tool,
  handle: vi.fn(async (args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> => {
    return { content: [{ type: 'text', text: `${context.toolName}:${String(args.message)}` }] };
  }),
});

const buildDispatcher = (mode: McpConfig['sessionMode'] = 'stateless') => {
  const tools = new McpToolHandlerMap();
  const tool = echoTool();
  tools.set('echo', tool);
  const resources = new McpResourceHandlerMap();
  const config: McpConfig = { serverName: 'test', version: '0.0.0', sessionMode: mode };
  const logger = makeLogger();
  const factory = new McpServerFactory(tools, resources, config, logger);
  const registry = new McpSessionRegistry(factory, logger);
  return { dispatcher: new McpDispatcher(factory, registry, config, logger), tool };
};

const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: '2.0' as const, id, method, ...(params ? { params } : {}) });

describe('McpDispatcher (stateless)', () => {
  it('defaults to stateless mode', () => {
    expect(buildDispatcher(undefined).dispatcher.sessionMode).toBe('stateless');
  });

  it('lists registered tools from the memoized advertisement', async () => {
    const { dispatcher } = buildDispatcher();
    const response = await dispatcher.dispatch(rpc(1, 'tools/list'), makeContext());
    expect(response).toMatchObject({ id: 1, result: { tools: [{ name: 'echo' }] } });
  });

  it('routes a tools/call to the registered handler with a per-request context', async () => {
    const { dispatcher, tool } = buildDispatcher();
    const response = await dispatcher.dispatch(rpc(2, 'tools/call', { name: 'echo', arguments: { message: 'hi' } }), makeContext());
    expect(response).toMatchObject({ id: 2, result: { content: [{ type: 'text', text: 'echo:hi' }] } });
    expect(tool.handle).toHaveBeenCalledWith({ message: 'hi' }, expect.objectContaining({ toolName: 'echo', requestId: 'req-1' }));
  });

  it('errors when calling an unregistered tool', async () => {
    const { dispatcher } = buildDispatcher();
    const response = (await dispatcher.dispatch(rpc(3, 'tools/call', { name: 'nope', arguments: {} }), makeContext())) as { error?: unknown };
    expect(response.error).toBeDefined();
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
