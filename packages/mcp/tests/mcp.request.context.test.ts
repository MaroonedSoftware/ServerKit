import { describe, it, expect } from 'vitest';
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
});
