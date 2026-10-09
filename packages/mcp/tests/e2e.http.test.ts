import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpDispatcher } from '../src/mcp.dispatcher.js';
import { McpServerFactory } from '../src/mcp.server.factory.js';
import { McpSessionRegistry } from '../src/mcp.session.registry.js';
import { McpToolHandlerMap, type McpToolHandler } from '../src/mcp.tool.handler.js';
import { McpResourceHandlerMap } from '../src/mcp.resource.handler.js';
import { McpPromptHandlerMap } from '../src/mcp.prompt.handler.js';
import { createMcpRequestContext, type McpContextBase } from '../src/mcp.request.context.js';
import type { McpConfig } from '../src/mcp.config.js';
import type { McpDispatchOptions } from '../src/mcp.instructions.js';
import { mcpUiSupport, MCP_UI_EXTENSION, MCP_UI_MIME_TYPE } from '../src/mcp.ui.js';
import { makeAuthenticatedSession, makeLogger } from './helpers.js';

/** A tool that upper-cases its message, so we can prove args flow end to end. */
const shoutTool = (): McpToolHandler => ({
  definition: {
    name: 'shout',
    description: 'Upper-case the message.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  } satisfies Tool,
  async handle(args): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: String(args.message).toUpperCase() }] };
  },
});

/** A tool that reports what the server knows about the client's MCP UI support. */
const uiSupportTool = (): McpToolHandler => ({
  definition: { name: 'ui_support', inputSchema: { type: 'object', properties: {} } },
  async handle(_args, context): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: mcpUiSupport(context) }] };
  },
});

const buildDispatcher = (sessionMode: McpConfig['sessionMode'], overrides: Partial<McpConfig> = {}) => {
  const tools = new McpToolHandlerMap();
  tools.set('shout', shoutTool());
  tools.set('ui_support', uiSupportTool());
  const config: McpConfig = { serverName: 'e2e-server', version: '1.0.0', sessionMode, ...overrides };
  const logger = makeLogger();
  const factory = new McpServerFactory(tools, new McpResourceHandlerMap(), new McpPromptHandlerMap(), config, logger);
  const registry = new McpSessionRegistry(factory, logger);
  return new McpDispatcher(factory, registry, config, logger);
};

/** Reads the full request body as a string (what a koa body parser would give you). */
const readBody = (req: import('node:http').IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const listen = (server: HttpServer): Promise<string> =>
  new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}/mcp`);
    });
  });

const close = (server: HttpServer): Promise<void> => new Promise(resolve => server.close(() => resolve()));

const initialize = (id: number) => ({
  jsonrpc: '2.0' as const,
  id,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } },
});

/** Serves a stateful dispatcher over real HTTP, the way a koa route hands it `req`/`res`. */
const serveStateful = (dispatcher: McpDispatcher, options?: McpDispatchOptions): HttpServer =>
  createServer((req, res) => {
    void (async () => {
      const raw = req.method === 'POST' ? await readBody(req) : '';
      const body = raw ? JSON.parse(raw) : undefined;
      const sessionId = Array.isArray(req.headers['mcp-session-id']) ? req.headers['mcp-session-id'][0] : req.headers['mcp-session-id'];
      const context = createMcpRequestContext({ requestId: 'req-e2e', logger: makeLogger(), authenticationSession: makeAuthenticatedSession() });
      await dispatcher.dispatchStateful({ req, res, body, sessionId }, context, options);
    })();
  });

describe('MCP e2e over real HTTP', () => {
  describe('stateless (raw JSON-RPC over the wire)', () => {
    let server: HttpServer;
    let url: string;

    beforeAll(async () => {
      const dispatcher = buildDispatcher('stateless');
      server = createServer((req, res) => {
        void (async () => {
          const raw = await readBody(req);
          const context = createMcpRequestContext({ requestId: 'req-e2e', logger: makeLogger() });
          const response = await dispatcher.dispatch(JSON.parse(raw), context);
          if (response) {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(response));
          } else {
            res.statusCode = 202;
            res.end();
          }
        })();
      });
      url = await listen(server);
    });
    afterAll(() => close(server));

    const post = async (message: unknown) => {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) });
      return res.json();
    };

    it('answers initialize with server info + capabilities', async () => {
      const result = await post(initialize(1));
      expect(result).toMatchObject({ id: 1, result: { serverInfo: { name: 'e2e-server' }, capabilities: { tools: {} } } });
      expect(result).not.toHaveProperty('result.capabilities.prompts');
    });

    it('omits instructions from initialize when none are configured', async () => {
      const result = await post(initialize(1));
      expect(result).not.toHaveProperty('result.instructions');
    });

    it('lists tools and executes a tools/call over the wire', async () => {
      const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      expect(list).toMatchObject({ id: 2, result: { tools: [{ name: 'shout' }, { name: 'ui_support' }] } });

      const call = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'shout', arguments: { message: 'hello wire' } } });
      expect(call).toMatchObject({ id: 3, result: { content: [{ type: 'text', text: 'HELLO WIRE' }] } });
    });

    it('reports MCP UI support as unknown, since no initialize reached this server', async () => {
      const call = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ui_support', arguments: {} } });
      expect(call).toMatchObject({ id: 4, result: { content: [{ type: 'text', text: 'unknown' }] } });
    });
  });

  describe('stateful (official MCP Client + StreamableHTTP transport)', () => {
    let server: HttpServer;
    let url: string;

    beforeAll(async () => {
      server = serveStateful(buildDispatcher('stateful'));
      url = await listen(server);
    });
    afterAll(() => close(server));

    it('completes a real initialize handshake, then lists + calls a tool', async () => {
      const client = new Client({ name: 'e2e-client', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(url));
      await client.connect(transport); // performs the initialize handshake + opens the session

      const tools = await client.listTools();
      expect(tools.tools.map(t => t.name)).toContain('shout');

      const result = (await client.callTool({ name: 'shout', arguments: { message: 'over sse' } })) as CallToolResult;
      expect(result.content).toEqual([{ type: 'text', text: 'OVER SSE' }]);

      await client.close();
    });

    const uiSupportFor = async (client: Client): Promise<unknown> => {
      await client.connect(new StreamableHTTPClientTransport(new URL(url)));
      const result = (await client.callTool({ name: 'ui_support', arguments: {} })) as CallToolResult;
      await client.close();
      return result.content;
    };

    it('tells handlers the client supports MCP UI when it negotiated the extension', async () => {
      const client = new Client(
        { name: 'ui-client', version: '1.0.0' },
        { capabilities: { extensions: { [MCP_UI_EXTENSION]: { mimeTypes: [MCP_UI_MIME_TYPE] } } } },
      );
      expect(await uiSupportFor(client)).toEqual([{ type: 'text', text: 'supported' }]);
    });

    it('tells handlers the client does not support MCP UI when it left the extension out', async () => {
      expect(await uiSupportFor(new Client({ name: 'plain-client', version: '1.0.0' }))).toEqual([{ type: 'text', text: 'unsupported' }]);
    });
  });

  describe('instructions', () => {
    const instructions = 'Use shout to upper-case a message.';

    it('returns McpConfig.instructions from a stateless initialize', async () => {
      const dispatcher = buildDispatcher('stateless', { instructions });
      const context = createMcpRequestContext({ requestId: 'req-e2e', logger: makeLogger() });
      const response = await dispatcher.dispatch(initialize(1), context);
      expect(response).toMatchObject({ id: 1, result: { instructions } });
    });

    it('hands McpConfig.instructions to a client over a stateful session', async () => {
      const server = serveStateful(buildDispatcher('stateful', { instructions }));
      const url = await listen(server);
      const client = new Client({ name: 'e2e-client', version: '1.0.0' });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(url)));
        expect(client.getInstructions()).toBe(instructions);
      } finally {
        await client.close();
        await close(server);
      }
    });

    const dispatchInitialize = async (config: Partial<McpConfig>, options: McpDispatchOptions) => {
      const dispatcher = buildDispatcher('stateless', config);
      const context = createMcpRequestContext({ requestId: 'req-e2e', logger: makeLogger(), authenticationSession: makeAuthenticatedSession() });
      return dispatcher.dispatch(initialize(1), context, options);
    };

    it('lets a per-dispatch string override McpConfig.instructions', async () => {
      const response = await dispatchInitialize({ instructions }, { instructions: 'HRIS endpoint.' });
      expect(response).toMatchObject({ result: { instructions: 'HRIS endpoint.' } });
    });

    it('resolves instructions from the caller on initialize', async () => {
      const resolver = vi.fn((context: McpContextBase) => `Hello ${context.authenticationSession?.subject}.`);
      const response = await dispatchInitialize({}, { instructions: resolver });
      expect(response).toMatchObject({ result: { instructions: 'Hello user-1.' } });
      expect(resolver).toHaveBeenCalledTimes(1);
    });

    it('awaits an async resolver', async () => {
      const response = await dispatchInitialize({}, { instructions: async () => 'async text' });
      expect(response).toMatchObject({ result: { instructions: 'async text' } });
    });

    it('falls back to McpConfig.instructions when the resolver returns undefined', async () => {
      const response = await dispatchInitialize({ instructions }, { instructions: () => undefined });
      expect(response).toMatchObject({ result: { instructions } });
    });

    it('sends no instructions when the resolver returns an empty string', async () => {
      const response = await dispatchInitialize({ instructions }, { instructions: () => '' });
      expect(response).not.toHaveProperty('result.instructions');
    });

    it('does not run the resolver for messages other than initialize', async () => {
      const resolver = vi.fn(() => 'unused');
      const dispatcher = buildDispatcher('stateless');
      const context = createMcpRequestContext({ requestId: 'req-e2e', logger: makeLogger() });
      const response = await dispatcher.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, context, { instructions: resolver });
      expect(response).toMatchObject({ id: 2, result: { tools: [{ name: 'shout' }, { name: 'ui_support' }] } });
      expect(resolver).not.toHaveBeenCalled();
    });

    it('resolves instructions once per stateful session, from the caller that opened it', async () => {
      const resolver = vi.fn((context: McpContextBase) => `Hello ${context.authenticationSession?.subject}.`);
      const server = serveStateful(buildDispatcher('stateful', { instructions }), { instructions: resolver });
      const url = await listen(server);
      const client = new Client({ name: 'e2e-client', version: '1.0.0' });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(url)));
        await client.listTools();
        expect(client.getInstructions()).toBe('Hello user-1.');
        expect(resolver).toHaveBeenCalledTimes(1);
      } finally {
        await client.close();
        await close(server);
      }
    });

    it('treats a blank instructions string as unset', async () => {
      const dispatcher = buildDispatcher('stateless', { instructions: '' });
      const context = createMcpRequestContext({ requestId: 'req-e2e', logger: makeLogger() });
      const response = await dispatcher.dispatch(initialize(1), context);
      expect(response).toMatchObject({ id: 1, result: { serverInfo: { name: 'e2e-server' } } });
      expect(response).not.toHaveProperty('result.instructions');
    });
  });
});
