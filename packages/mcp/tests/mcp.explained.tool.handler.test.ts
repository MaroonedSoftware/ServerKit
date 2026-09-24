import { describe, it, expect, vi } from 'vitest';
import { httpError, type HttpError } from '@maroonedsoftware/errors';
import type { CallToolResult, JSONRPCMessage, Tool } from '@modelcontextprotocol/sdk/types.js';
import { ExplainedToolHandler, explainToolErrors } from '../src/mcp.explained.tool.handler.js';
import { McpToolHandlerMap, type McpToolHandler } from '../src/mcp.tool.handler.js';
import { McpResourceHandlerMap } from '../src/mcp.resource.handler.js';
import { McpServerFactory } from '../src/mcp.server.factory.js';
import { McpSessionRegistry } from '../src/mcp.session.registry.js';
import { McpDispatcher } from '../src/mcp.dispatcher.js';
import { McpError } from '../src/mcp.error.js';
import type { McpConfig } from '../src/mcp.config.js';
import { makeContext, makeLogger } from './helpers.js';

const definition = {
  name: 'create_ticket',
  description: 'Create a ticket.',
  inputSchema: { type: 'object', properties: {} },
} satisfies Tool;

/** A handler that throws `error`, or returns `result` when no error is given. */
const toolThrowing = (error?: unknown, result: CallToolResult = { content: [{ type: 'text', text: 'ok' }] }): McpToolHandler => ({
  definition,
  handle: vi.fn(async () => {
    if (error !== undefined) throw error;
    return result;
  }),
});

const call = (error: unknown) => new ExplainedToolHandler(toolThrowing(error)).handle({}, makeContext().forTool('create_ticket'));

const textOf = (result: CallToolResult): string => {
  const [block] = result.content;
  if (block?.type !== 'text') throw new Error('expected a text block');
  return block.text;
};

describe('ExplainedToolHandler', () => {
  describe('passing through', () => {
    it('returns a successful result untouched', async () => {
      const result: CallToolResult = { content: [{ type: 'text', text: 'created' }] };
      const handler = new ExplainedToolHandler(toolThrowing(undefined, result));

      await expect(handler.handle({}, makeContext().forTool('create_ticket'))).resolves.toBe(result);
    });

    it("advertises the wrapped handler's definition", () => {
      expect(new ExplainedToolHandler(toolThrowing()).definition).toBe(definition);
    });

    it('rethrows a plain Error', async () => {
      const error = new Error('boom');
      await expect(call(error)).rejects.toBe(error);
    });

    it('rethrows a ServerkitError that is not an HttpError', async () => {
      const error = new McpError('not http');
      await expect(call(error)).rejects.toBe(error);
    });
  });

  describe('400 and 422', () => {
    it('lists each field by path, without the body./query. prefix, then asks for them', async () => {
      const error = httpError(400).withDetails({
        'body.email': 'Invalid email',
        'query.page': 'Expected number',
        'body.tags': ['Must be at least 1', 'Expected string'],
        _root: 'Unrecognized key',
      });

      const result = await call(error);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        [
          'The arguments were not valid:',
          '- email: Invalid email',
          '- page: Expected number',
          '- tags: Must be at least 1; Expected string',
          '- the arguments as a whole: Unrecognized key',
          'Ask the user for these, then call the tool again.',
        ].join('\n'),
      );
    });

    it('explains a 422 the same way', async () => {
      const result = await call(httpError(422).withDetails({ 'user.name': 'Expected string' }));

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('- user.name: Expected string');
    });

    it('falls back to a general request when there are no usable details', async () => {
      const result = await call(httpError(400));

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('The arguments were not valid. Ask the user for the correct values, then call the tool again.');
    });
  });

  describe('401 and 403', () => {
    it.each([401, 403] as const)('says the caller is not allowed on a %i', async status => {
      const result = await call(httpError(status).withDetails({ secret: 'internal' }));

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('This caller is not allowed to do that.');
    });

    it('names the scope an insufficient_scope challenge asks for', async () => {
      const error = httpError(403).withHeaders({ 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="tickets:write"' });

      expect(textOf(await call(error))).toBe('This caller is not allowed to do that. It needs the `tickets:write` scope.');
    });

    it('reads the challenge header case-insensitively', async () => {
      const error = httpError(403).withHeaders({ 'www-authenticate': 'Bearer error="insufficient_scope", scope="tickets:write"' });

      expect(textOf(await call(error))).toContain('`tickets:write`');
    });

    it('adds nothing for a challenge that is not about scope', async () => {
      const error = httpError(401).withHeaders({ 'WWW-Authenticate': 'Bearer error="invalid_token"' });

      expect(textOf(await call(error))).toBe('This caller is not allowed to do that.');
    });
  });

  describe('404 and 409', () => {
    it.each([
      [404, 'Ticket not found'],
      [409, 'Ticket already exists'],
    ] as const)('relays the message of a %i', async (status, message) => {
      const error = httpError(status);
      error.message = message;

      const result = await call(error);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(message);
    });
  });

  describe('everything else', () => {
    it.each([500, 429, 502] as const)('gives a generic failure for a %i without the internal message', async status => {
      const error: HttpError = httpError(status).withDetails({ table: 'tickets' }).withInternalDetails({ query: 'select *' });
      error.message = 'connection to db-7 refused';

      const result = await call(error);
      const text = textOf(result);

      expect(result.isError).toBe(true);
      expect(text).toBe('The tool failed. Try again later.');
      expect(text).not.toContain('db-7');
      expect(text).not.toContain('tickets');
    });

    it('logs the hidden failure at error level', async () => {
      const context = makeContext().forTool('create_ticket');
      const error = httpError(500);

      await new ExplainedToolHandler(toolThrowing(error)).handle({}, context);

      expect(context.logger.error).toHaveBeenCalledWith(
        'MCP tool call failed',
        expect.objectContaining({ tool: 'create_ticket', statusCode: 500, error }),
      );
    });
  });
});

describe('explainToolErrors', () => {
  it('returns a new map with every handler wrapped under the same key', () => {
    const tools = new McpToolHandlerMap([
      ['create_ticket', toolThrowing()],
      ['close_ticket', toolThrowing()],
    ]);

    const explained = explainToolErrors(tools);

    expect(explained).not.toBe(tools);
    expect(explained).toBeInstanceOf(McpToolHandlerMap);
    expect([...explained.keys()]).toEqual(['create_ticket', 'close_ticket']);
    for (const handler of explained.values()) expect(handler).toBeInstanceOf(ExplainedToolHandler);
    expect(tools.get('create_ticket')).not.toBeInstanceOf(ExplainedToolHandler);
  });

  it('turns a thrown HttpError into a tool result through the dispatcher', async () => {
    const tools = explainToolErrors(
      new McpToolHandlerMap([['create_ticket', toolThrowing(httpError(400).withDetails({ 'body.title': 'Expected string' }))]]),
    );
    const config: McpConfig = { serverName: 'test', version: '0.0.0' };
    const logger = makeLogger();
    const factory = new McpServerFactory(tools, new McpResourceHandlerMap(), config, logger);
    const dispatcher = new McpDispatcher(factory, new McpSessionRegistry(factory, logger), config, logger);
    const request: JSONRPCMessage = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_ticket', arguments: {} } };

    const response = (await dispatcher.dispatch(request, makeContext())) as { error?: unknown; result?: CallToolResult };

    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    expect(response.result && textOf(response.result)).toContain('- title: Expected string');
  });
});
