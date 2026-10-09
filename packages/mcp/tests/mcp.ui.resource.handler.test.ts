import { describe, it, expect } from 'vitest';
import type { McpResourceContext } from '../src/mcp.request.context.js';
import { McpUiResource, type McpUiResourceOptions } from '../src/mcp.ui.resource.handler.js';
import { MCP_UI_MIME_TYPE } from '../src/mcp.ui.js';
import { makeContext } from './helpers.js';

class TestApp extends McpUiResource {
  seen?: McpResourceContext;

  constructor(options: McpUiResourceOptions) {
    super(options);
  }

  protected async html(context: McpResourceContext): Promise<string> {
    this.seen = context;
    return '<html>app</html>';
  }
}

const ui = { csp: { connectDomains: ['https://api.example.com'] }, prefersBorder: true };

describe('McpUiResource', () => {
  it('advertises the MCP Apps MIME type and _meta.ui', () => {
    const app = new TestApp({ uri: 'ui://charts/metric', name: 'metric_chart', title: 'Metric chart', description: 'A chart.', ui });
    expect(app.definition).toEqual({
      uri: 'ui://charts/metric',
      name: 'metric_chart',
      title: 'Metric chart',
      description: 'A chart.',
      mimeType: MCP_UI_MIME_TYPE,
      _meta: { ui },
    });
  });

  it('omits unset optional fields from the definition', () => {
    expect(new TestApp({ uri: 'ui://a', name: 'a' }).definition).toStrictEqual({ uri: 'ui://a', name: 'a', mimeType: MCP_UI_MIME_TYPE });
  });

  it('rejects a uri outside the ui:// scheme', () => {
    expect(() => new TestApp({ uri: 'https://example.com/app', name: 'a' })).toThrow(/ui:\/\//);
  });

  it('reads the html into contents with the MIME type and _meta.ui', async () => {
    const app = new TestApp({ uri: 'ui://a', name: 'a', ui });
    const context = makeContext().forResource('ui://a');
    await expect(app.read('ui://a', context)).resolves.toEqual({
      contents: [{ uri: 'ui://a', mimeType: MCP_UI_MIME_TYPE, text: '<html>app</html>', _meta: { ui } }],
    });
    expect(app.seen).toBe(context);
  });

  it('leaves _meta off the contents when no ui metadata is set', async () => {
    const result = await new TestApp({ uri: 'ui://a', name: 'a' }).read('ui://a', makeContext().forResource('ui://a'));
    expect(result.contents[0]).not.toHaveProperty('_meta');
  });
});
