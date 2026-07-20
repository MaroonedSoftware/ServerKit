import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
import { createMcpRequestContext } from '../src/mcp.request.context.js';
import type { McpConfig } from '../src/mcp.config.js';
import { makeLogger } from './helpers.js';

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

const buildDispatcher = (sessionMode: McpConfig['sessionMode']) => {
  const tools = new McpToolHandlerMap();
  tools.set('shout', shoutTool());
  const config: McpConfig = { serverName: 'e2e-server', version: '1.0.0', sessionMode };
  const logger = makeLogger();
  const factory = new McpServerFactory(tools, new McpResourceHandlerMap(), config, logger);
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
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}/mcp`);
    });
  });

const close = (server: HttpServer): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

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
      const result = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } });
      expect(result).toMatchObject({ id: 1, result: { serverInfo: { name: 'e2e-server' }, capabilities: { tools: {} } } });
    });

    it('lists tools and executes a tools/call over the wire', async () => {
      const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      expect(list).toMatchObject({ id: 2, result: { tools: [{ name: 'shout' }] } });

      const call = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'shout', arguments: { message: 'hello wire' } } });
      expect(call).toMatchObject({ id: 3, result: { content: [{ type: 'text', text: 'HELLO WIRE' }] } });
    });
  });

  describe('stateful (official MCP Client + StreamableHTTP transport)', () => {
    let server: HttpServer;
    let url: string;

    beforeAll(async () => {
      const dispatcher = buildDispatcher('stateful');
      server = createServer((req, res) => {
        void (async () => {
          const raw = req.method === 'POST' ? await readBody(req) : '';
          const body = raw ? JSON.parse(raw) : undefined;
          const sessionId = Array.isArray(req.headers['mcp-session-id']) ? req.headers['mcp-session-id'][0] : req.headers['mcp-session-id'];
          const context = createMcpRequestContext({ requestId: 'req-e2e', logger: makeLogger() });
          await dispatcher.dispatchStateful({ req, res, body, sessionId }, context);
        })();
      });
      url = await listen(server);
    });
    afterAll(() => close(server));

    it('completes a real initialize handshake, then lists + calls a tool', async () => {
      const client = new Client({ name: 'e2e-client', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(url));
      await client.connect(transport); // performs the initialize handshake + opens the session

      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain('shout');

      const result = (await client.callTool({ name: 'shout', arguments: { message: 'over sse' } })) as CallToolResult;
      expect(result.content).toEqual([{ type: 'text', text: 'OVER SSE' }]);

      await client.close();
    });
  });
});
