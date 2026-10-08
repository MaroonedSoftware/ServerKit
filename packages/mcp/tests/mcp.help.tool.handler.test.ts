import { describe, it, expect, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHelpToolHandler, MCP_DEFAULT_HELP_TOOL_DESCRIPTION, MCP_DEFAULT_HELP_TOOL_NAME } from '../src/mcp.help.tool.handler.js';
import { McpToolHandlerMap, type McpToolHandler } from '../src/mcp.tool.handler.js';
import { explainToolErrors } from '../src/mcp.explained.tool.handler.js';
import { McpPromptHandlerMap, type McpPromptHandler } from '../src/mcp.prompt.handler.js';
import type { McpContextBase } from '../src/mcp.request.context.js';
import { makeAuthenticatedSession, makeContext } from './helpers.js';

const tool = (name: string, description?: string): McpToolHandler => ({
  definition: { name, description, inputSchema: { type: 'object', properties: {} } },
  handle: async (): Promise<CallToolResult> => ({ content: [] }),
});

const textOf = (result: CallToolResult): string => {
  const [first] = result.content;
  return first?.type === 'text' ? first.text : '';
};

const call = async (help: McpHelpToolHandler, context = makeContext()) => textOf(await help.handle({}, context.forTool(help.definition.name)));

describe('McpHelpToolHandler', () => {
  it('advertises a default name, description and an empty input schema', () => {
    const help = new McpHelpToolHandler({ tools: new McpToolHandlerMap() });
    expect(help.definition).toEqual({
      name: MCP_DEFAULT_HELP_TOOL_NAME,
      description: MCP_DEFAULT_HELP_TOOL_DESCRIPTION,
      inputSchema: { type: 'object', properties: {} },
    });
  });

  it('takes a custom name and description', () => {
    const help = new McpHelpToolHandler({ tools: new McpToolHandlerMap(), name: 'get_started', description: 'Start here.' });
    expect(help.definition).toMatchObject({ name: 'get_started', description: 'Start here.' });
  });

  it('opens with the overview, then lists the other tools and leaves itself out', async () => {
    const tools = new McpToolHandlerMap([
      ['search_docs', tool('search_docs', 'Search the docs.')],
      ['ping', tool('ping')],
    ]);
    const help = new McpHelpToolHandler({ tools, overview: 'Answers questions about docs.' });
    tools.set('help', help);

    expect(await call(help)).toBe('Answers questions about docs.\n\nTools:\n- search_docs: Search the docs.\n- ping');
  });

  it('leaves itself out when explainToolErrors has wrapped it', async () => {
    const tools = new McpToolHandlerMap([['ping', tool('ping', 'Ping.')]]);
    tools.set('help', new McpHelpToolHandler({ tools }));
    const wrapped = explainToolErrors(tools);
    const help = new McpHelpToolHandler({ tools: wrapped });

    expect(await call(help)).toBe('Tools:\n- ping: Ping.');
  });

  it('sees tools registered after it was constructed', async () => {
    const tools = new McpToolHandlerMap();
    const help = new McpHelpToolHandler({ tools });
    tools.set('help', help);
    tools.set('ping', tool('ping', 'Ping.'));

    expect(await call(help)).toBe('Tools:\n- ping: Ping.');
  });

  it('resolves a function overview on every call, from the caller', async () => {
    const overview = vi.fn((context: McpContextBase) => `Hello ${context.authenticationSession?.subject ?? 'stranger'}.`);
    const tools = new McpToolHandlerMap();
    const help = new McpHelpToolHandler({ tools, overview });
    tools.set('help', help);

    expect(await call(help, makeContext({ authenticationSession: makeAuthenticatedSession() }))).toBe('Hello user-1.');
    expect(await call(help)).toBe('Hello stranger.');
    expect(overview).toHaveBeenCalledTimes(2);
  });

  it('lists prompts after the tools', async () => {
    const prompt = (name: string, description?: string): McpPromptHandler => ({
      definition: { name, description },
      get: async () => ({ messages: [] }),
    });
    const tools = new McpToolHandlerMap([['ping', tool('ping', 'Ping.')]]);
    const prompts = new McpPromptHandlerMap([
      ['welcome', prompt('welcome', 'Get started.')],
      ['tour', prompt('tour')],
    ]);
    const help = new McpHelpToolHandler({ tools, prompts });
    tools.set('help', help);

    expect(await call(help)).toBe('Tools:\n- ping: Ping.\n\nPrompts:\n- welcome: Get started.\n- tour');
  });

  it('answers with an empty text when there is neither overview nor other tools', async () => {
    const tools = new McpToolHandlerMap();
    const help = new McpHelpToolHandler({ tools, overview: '' });
    tools.set('help', help);

    expect(await call(help)).toBe('');
  });
});
