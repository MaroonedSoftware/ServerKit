import { describe, it, expect, vi } from 'vitest';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { CappedToolHandler, capToolResults, MCP_CUT_HINT } from '../src/mcp.capped.tool.handler.js';
import { McpToolHandlerMap, type McpToolHandler } from '../src/mcp.tool.handler.js';
import { McpError } from '../src/mcp.error.js';
import { makeContext } from './helpers.js';

const definition = {
  name: 'search_docs',
  description: 'Search the docs.',
  inputSchema: { type: 'object', properties: {} },
} satisfies Tool;

const toolReturning = (result: CallToolResult, tool: Tool = definition): McpToolHandler => ({
  definition: tool,
  handle: vi.fn(async () => result),
});

const call = (result: CallToolResult, maxChars: number, tool?: Tool) =>
  new CappedToolHandler(toolReturning(result, tool), { maxChars }).handle({}, makeContext().forTool('search_docs'));

const text = (value: string) => ({ type: 'text' as const, text: value });

describe('CappedToolHandler', () => {
  it('returns a result within the cap untouched', async () => {
    const result: CallToolResult = { content: [text('12345')], structuredContent: { hits: 5 } };
    await expect(call(result, 5)).resolves.toBe(result);
  });

  it('cuts an oversized text result and ends it with the hint', async () => {
    const result = await call({ content: [text('abcdefghij')] }, 4);

    expect(result.content).toEqual([text(`abcd… [cut at 4 of 10 characters: ${MCP_CUT_HINT}]`)]);
    expect(result.isError).toBeUndefined();
  });

  it('counts across text blocks, cuts the one the cap falls in, and drops later text', async () => {
    const image = { type: 'image' as const, data: 'aGk=', mimeType: 'image/png' };
    const result = await call({ content: [text('abc'), image, text('defgh'), text('ijk')] }, 5);

    expect(result.content).toEqual([text('abc'), image, text(`de… [cut at 5 of 11 characters: ${MCP_CUT_HINT}]`)]);
  });

  it('drops structuredContent when it cuts', async () => {
    const result = await call({ content: [text('abcdefghij')], structuredContent: { hits: 10 } }, 4);

    expect(result).not.toHaveProperty('structuredContent');
    expect(result.isError).toBeUndefined();
  });

  it('marks the cut result an error when the tool declares an outputSchema', async () => {
    const tool = { ...definition, outputSchema: { type: 'object' as const, properties: {} } };
    const result = await call({ content: [text('abcdefghij')], structuredContent: {} }, 4, tool);

    expect(result.isError).toBe(true);
    expect(result).not.toHaveProperty('structuredContent');
  });

  it('keeps isError on a cut error result', async () => {
    const result = await call({ isError: true, content: [text('abcdefghij')] }, 4);
    expect(result.isError).toBe(true);
  });

  it('does not split a surrogate pair', async () => {
    const result = await call({ content: [text('ab😀cd')] }, 3);
    expect(result.content).toEqual([text(`ab… [cut at 3 of 6 characters: ${MCP_CUT_HINT}]`)]);
  });

  it('logs the cut at debug', async () => {
    const context = makeContext().forTool('search_docs');
    await new CappedToolHandler(toolReturning({ content: [text('abcdefghij')] }), { maxChars: 4 }).handle({}, context);

    expect(context.logger.debug).toHaveBeenCalledWith('MCP tool result cut', { tool: 'search_docs', maxChars: 4, characters: 10 });
  });

  it('lets a thrown error through', async () => {
    const error = new Error('boom');
    const handler: McpToolHandler = { definition, handle: vi.fn(async () => Promise.reject(error)) };

    await expect(new CappedToolHandler(handler, { maxChars: 4 }).handle({}, makeContext().forTool('search_docs'))).rejects.toBe(error);
  });

  it("advertises the wrapped handler's definition", () => {
    expect(new CappedToolHandler(toolReturning({ content: [] }), { maxChars: 1 }).definition).toBe(definition);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects maxChars %s', maxChars => {
    expect(() => new CappedToolHandler(toolReturning({ content: [] }), { maxChars })).toThrow(McpError);
  });
});

describe('capToolResults', () => {
  it('returns a new map with every handler wrapped under the same key', () => {
    const tools = new McpToolHandlerMap([
      ['search_docs', toolReturning({ content: [] })],
      ['list_docs', toolReturning({ content: [] })],
    ]);

    const capped = capToolResults(tools, { maxChars: 100 });

    expect(capped).not.toBe(tools);
    expect(capped).toBeInstanceOf(McpToolHandlerMap);
    expect([...capped.keys()]).toEqual(['search_docs', 'list_docs']);
    for (const handler of capped.values()) expect(handler).toBeInstanceOf(CappedToolHandler);
    expect(tools.get('search_docs')).not.toBeInstanceOf(CappedToolHandler);
  });
});
