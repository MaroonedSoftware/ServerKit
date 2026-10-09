import { describe, it, expect } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { IsMcpError } from '../src/mcp.error.js';
import {
  assertMcpUiUri,
  getMcpUiCapability,
  getMcpUiToolMeta,
  isMcpUiAppOnlyTool,
  mcpUiSupport,
  MCP_UI_EXTENSION,
  MCP_UI_MIME_TYPE,
  withMcpUi,
} from '../src/mcp.ui.js';
import { makeContext } from './helpers.js';

const tool = (extra: Partial<Tool> = {}): Tool => ({ name: 'show_chart', inputSchema: { type: 'object', properties: {} }, ...extra });

describe('withMcpUi', () => {
  it('adds _meta.ui to a tool without _meta', () => {
    expect(withMcpUi(tool(), { resourceUri: 'ui://charts/metric' })._meta).toEqual({ ui: { resourceUri: 'ui://charts/metric' } });
  });

  it('keeps other _meta keys and merges into an existing ui block', () => {
    const base = tool({ _meta: { other: 1, ui: { resourceUri: 'ui://a', visibility: ['model'] } } });
    expect(withMcpUi(base, { visibility: ['app'] })._meta).toEqual({ other: 1, ui: { resourceUri: 'ui://a', visibility: ['app'] } });
  });

  it('does not mutate the input tool', () => {
    const base = tool();
    withMcpUi(base, { resourceUri: 'ui://a' });
    expect(base._meta).toBeUndefined();
  });

  it('never emits the deprecated flat key', () => {
    expect(withMcpUi(tool(), { resourceUri: 'ui://a' })._meta).not.toHaveProperty('ui/resourceUri');
  });

  it('rejects a resourceUri outside the ui:// scheme', () => {
    expect(() => withMcpUi(tool(), { resourceUri: 'https://example.com' })).toThrow(/ui:\/\//);
  });
});

describe('assertMcpUiUri', () => {
  it('throws an McpError carrying the uri', () => {
    try {
      assertMcpUiUri('config://app');
      expect.unreachable();
    } catch (error) {
      expect(IsMcpError(error) && error.details).toEqual({ uri: 'config://app' });
    }
  });
});

describe('getMcpUiToolMeta', () => {
  it('returns undefined without a ui object', () => {
    expect(getMcpUiToolMeta(tool())).toBeUndefined();
    expect(getMcpUiToolMeta(tool({ _meta: { ui: 'nope' } }))).toBeUndefined();
  });
});

describe('isMcpUiAppOnlyTool', () => {
  it.each([
    [undefined, false],
    [['model'], false],
    [['model', 'app'], false],
    [['app'], true],
    [[], true],
  ] as const)('visibility %j → %s', (visibility, expected) => {
    const definition = visibility === undefined ? tool() : withMcpUi(tool(), { visibility: [...visibility] });
    expect(isMcpUiAppOnlyTool(definition)).toBe(expected);
  });
});

describe('getMcpUiCapability', () => {
  it('reads the advertised mime types', () => {
    const context = makeContext({ clientCapabilities: { extensions: { [MCP_UI_EXTENSION]: { mimeTypes: [MCP_UI_MIME_TYPE, 42] } } } });
    expect(getMcpUiCapability(context)).toEqual({ mimeTypes: [MCP_UI_MIME_TYPE] });
  });

  it('returns undefined for a missing or malformed capability', () => {
    expect(getMcpUiCapability(makeContext())).toBeUndefined();
    expect(getMcpUiCapability(makeContext({ clientCapabilities: {} }))).toBeUndefined();
    expect(getMcpUiCapability(makeContext({ clientCapabilities: { extensions: { [MCP_UI_EXTENSION]: {} } } }))).toBeUndefined();
  });
});

describe('mcpUiSupport', () => {
  it('is unknown without client capabilities', () => {
    expect(mcpUiSupport(makeContext())).toBe('unknown');
  });

  it('is supported when the client lists the MCP Apps mime type', () => {
    expect(mcpUiSupport(makeContext({ clientCapabilities: { extensions: { [MCP_UI_EXTENSION]: { mimeTypes: [MCP_UI_MIME_TYPE] } } } }))).toBe(
      'supported',
    );
  });

  it('is unsupported when capabilities leave the extension or mime type out', () => {
    expect(mcpUiSupport(makeContext({ clientCapabilities: {} }))).toBe('unsupported');
    expect(mcpUiSupport(makeContext({ clientCapabilities: { extensions: { [MCP_UI_EXTENSION]: { mimeTypes: ['text/html'] } } } }))).toBe(
      'unsupported',
    );
  });
});
