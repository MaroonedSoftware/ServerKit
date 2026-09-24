import { describe, it, expect } from 'vitest';
import type { Container } from 'injectkit';
import { createMcpRequestContext } from '../src/mcp.request.context.js';
import { makeAuthenticatedSession, makeLogger } from './helpers.js';

describe('createMcpRequestContext', () => {
  it('leaves authenticationSession undefined when the route did not supply one', () => {
    const context = createMcpRequestContext({ requestId: 'req-1', logger: makeLogger() });

    expect(context.authenticationSession).toBeUndefined();
    expect(context.forTool('echo').authenticationSession).toBeUndefined();
    expect(context.forResource('config://app').authenticationSession).toBeUndefined();
  });

  it('carries the same session onto the request, tool, and resource contexts', () => {
    const authenticationSession = makeAuthenticatedSession();
    const context = createMcpRequestContext({ requestId: 'req-1', logger: makeLogger(), authenticationSession });

    expect(context.authenticationSession).toBe(authenticationSession);
    expect(context.forTool('echo').authenticationSession).toBe(authenticationSession);
    expect(context.forResource('config://app').authenticationSession).toBe(authenticationSession);
  });

  it('carries auth alongside the session', () => {
    const authenticationSession = makeAuthenticatedSession();
    const auth = { token: 'sk-token', subject: 'user-1' };
    const context = createMcpRequestContext({ requestId: 'req-1', logger: makeLogger(), auth, authenticationSession });

    const tool = context.forTool('echo');
    expect(tool.auth).toBe(auth);
    expect(tool.authenticationSession).toBe(authenticationSession);
    expect(tool.toolName).toBe('echo');
    expect(tool.requestId).toBe('req-1');
  });

  it('leaves container undefined when the route did not supply one', () => {
    const context = createMcpRequestContext({ requestId: 'req-1', logger: makeLogger() });

    expect(context.container).toBeUndefined();
    expect(context.forTool('echo').container).toBeUndefined();
    expect(context.forResource('config://app').container).toBeUndefined();
  });

  it('carries the same container onto the request, tool, and resource contexts', () => {
    const container = { get: () => undefined } as unknown as Container;
    const context = createMcpRequestContext({ requestId: 'req-1', logger: makeLogger(), container });

    expect(context.container).toBe(container);
    expect(context.forTool('echo').container).toBe(container);
    expect(context.forResource('config://app').container).toBe(container);
  });
});
