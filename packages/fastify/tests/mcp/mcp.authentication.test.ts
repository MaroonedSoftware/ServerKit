import { describe, it, expect, vi } from 'vitest';
import {
  AuthenticationHandlerChain,
  AuthenticationHandlerMap,
  AuthenticationSchemeHandler,
  ChainedAuthenticationHandler,
  invalidAuthenticationSession,
  type AuthenticationHandler,
} from '@maroonedsoftware/authentication';
import { Logger } from '@maroonedsoftware/logger';
import { PolicyService } from '@maroonedsoftware/policies';
import type { ServerKitModule } from '@maroonedsoftware/servercore';
import {
  McpAuthenticationHandler,
  McpConfig,
  McpDispatcher,
  McpResourceHandlerMap,
  McpServerFactory,
  McpSessionRegistry,
  McpToolHandlerMap,
  createMcpRequestContext,
  requireMcpPolicy,
  type McpToolContext,
  type McpToolHandler,
} from '@maroonedsoftware/mcp';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { Injectable } from 'injectkit';
import { errorPlugin } from '../../src/plugins/error.plugin.js';
import { serverKitContextPlugin } from '../../src/plugins/serverkit.context.plugin.js';
import { bodyParserPlugin } from '../../src/plugins/body.parser.plugin.js';
import { authenticationPlugin } from '../../src/plugins/authentication.plugin.js';
import { requirePolicy } from '../../src/hooks/require.policy.hook.js';
import { createTestApp } from '../test.app.js';

const TOKEN = 'sk-test';

/**
 * A tool that reports who the caller is. If the session did not survive the
 * request, this cannot answer.
 */
@Injectable()
class WhoamiTool implements McpToolHandler {
  constructor(private readonly policies: PolicyService) {}

  readonly definition = { name: 'whoami', description: 'Report the caller', inputSchema: { type: 'object' as const, properties: {} } };

  async handle(_args: Record<string, unknown>, context: McpToolContext) {
    const session = await requireMcpPolicy(context, this.policies);
    return { content: [{ type: 'text' as const, text: session.subject }] };
  }
}

/** Stands in for a JWT handler: shares the bearer scheme, declines everything. */
@Injectable()
class DecliningBearerHandler implements AuthenticationHandler {
  async authenticate() {
    return invalidAuthenticationSession;
  }
}

/** Chain order is the thing under test in one case, so it is a parameter. */
type ChainOrder = 'mcpFirst' | 'mcpLast';

const mcpModule = (config: Partial<McpConfig>, order: ChainOrder = 'mcpFirst'): ServerKitModule => ({
  name: 'mcp',
  setup: async registry => {
    registry.register(McpConfig).useValue({ serverName: 'test', version: '0.0.0', ...config });
    registry.register(PolicyService).useInstance({ assert: vi.fn(async () => {}) } as unknown as PolicyService);

    // Scheme dispatch: the MCP handler shares `bearer` with another handler,
    // through the chain.
    registry.register(McpAuthenticationHandler).useClass(McpAuthenticationHandler).asSingleton();
    registry.register(DecliningBearerHandler).useClass(DecliningBearerHandler).asSingleton();
    const chain = registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain);
    if (order === 'mcpFirst') chain.push(McpAuthenticationHandler).push(DecliningBearerHandler);
    else chain.push(DecliningBearerHandler).push(McpAuthenticationHandler);
    registry.register(ChainedAuthenticationHandler).useClass(ChainedAuthenticationHandler).asSingleton();
    registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', ChainedAuthenticationHandler);
    registry.register(AuthenticationSchemeHandler).useClass(AuthenticationSchemeHandler);

    // MCP itself.
    registry.register(WhoamiTool).useClass(WhoamiTool).asSingleton();
    registry.register(McpToolHandlerMap).useMap(McpToolHandlerMap).set('whoami', WhoamiTool);
    registry.register(McpResourceHandlerMap).useMap(McpResourceHandlerMap);
    registry.register(McpServerFactory).useClass(McpServerFactory).asSingleton();
    registry.register(McpSessionRegistry).useClass(McpSessionRegistry).asSingleton();
    registry.register(McpDispatcher).useClass(McpDispatcher).asSingleton();
  },
});

const build = async (config: Partial<McpConfig> = { bearerToken: TOKEN }, order: ChainOrder = 'mcpFirst') => {
  const { app } = await createTestApp({
    modules: [mcpModule(config, order)],
    plugins: container => [errorPlugin(container), serverKitContextPlugin(container), bodyParserPlugin(), authenticationPlugin()],
  });

  app.post('/mcp', { config: { body: ['application/json'] }, preHandler: [requirePolicy({ policy: false })] }, async (request, reply) => {
    const dispatcher = request.container.get(McpDispatcher);
    const context = createMcpRequestContext({
      requestId: request.requestId,
      logger: request.container.get(Logger),
      authenticationSession: request.authenticationSession,
    });

    const response = await dispatcher.dispatch(request.body as JSONRPCMessage, context);
    if (response) return response;
    reply.status(202);
    return undefined;
  });

  return app;
};

const call = (app: Awaited<ReturnType<typeof build>>, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { 'content-type': 'application/json', ...headers },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
  });

describe('MCP behind the fastify authentication stack', () => {
  it('authenticates the shared token even though authenticationPlugin deletes the header', async () => {
    // The case this whole path exists for: `authenticationPlugin` reads
    // `Authorization`, hands it to the scheme handler, and deletes it before any
    // route runs. Because the MCP token is resolved into a session there, the
    // tool still knows who called.
    const app = await build();

    const response = await call(app, { authorization: `Bearer ${TOKEN}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ result: { content: [{ type: 'text', text: 'mcp' }] } });
  });

  it('confirms the route handler cannot see the Authorization header', async () => {
    // Pins the reason the deprecated header-reading path fails here.
    const seen: (string | undefined)[] = [];
    const app = await build();
    app.addHook('preHandler', async request => void seen.push(request.headers.authorization));

    await call(app, { authorization: `Bearer ${TOKEN}` });

    expect(seen).toEqual([undefined]);
  });

  it('uses the configured subject', async () => {
    const app = await build({ bearerToken: TOKEN, subject: 'claude.desktop' });

    const response = await call(app, { authorization: `Bearer ${TOKEN}` });

    expect(response.json()).toMatchObject({ result: { content: [{ type: 'text', text: 'claude.desktop' }] } });
  });

  it('answers 401 when no Authorization header is present', async () => {
    const app = await build();

    const response = await call(app);

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('answers 401 for a token that does not match', async () => {
    const app = await build();

    const response = await call(app, { authorization: 'Bearer wrong-token' });

    expect(response.statusCode).toBe(401);
  });

  it('authenticates regardless of the MCP handler’s position in the chain', async () => {
    const app = await build({ bearerToken: TOKEN }, 'mcpLast');

    const response = await call(app, { authorization: `Bearer ${TOKEN}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ result: { content: [{ type: 'text', text: 'mcp' }] } });
  });

  it('answers 500 for a blank configured token rather than letting it read as open mode', async () => {
    const app = await build({ bearerToken: '' });

    const response = await call(app, { authorization: `Bearer ${TOKEN}` });

    expect(response.statusCode).toBe(500);
  });

  it('answers 500 when no token is configured and allowUnauthenticated was not set', async () => {
    const app = await build({});

    const response = await call(app, { authorization: `Bearer ${TOKEN}` });

    expect(response.statusCode).toBe(500);
  });
});
