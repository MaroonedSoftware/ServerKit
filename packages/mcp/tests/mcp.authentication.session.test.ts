import { describe, it, expect } from 'vitest';
import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { IsHttpError } from '@maroonedsoftware/errors';
import { requireMcpAuthenticationSession } from '../src/mcp.authentication.session.js';
import type { McpResourceContext, McpToolContext } from '../src/mcp.request.context.js';
import { makeAuthenticatedSession, makeLogger } from './helpers.js';

const toolContext = (authenticationSession?: McpToolContext['authenticationSession']): McpToolContext => ({
  requestId: 'req-1',
  logger: makeLogger(),
  toolName: 'echo',
  authenticationSession,
});

const expectUnauthorized = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(IsHttpError(error)).toBe(true);
    if (IsHttpError(error)) {
      expect(error.statusCode).toBe(401);
      expect(error.headers?.['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
    }
    return;
  }
  throw new Error('expected requireMcpAuthenticationSession to throw');
};

describe('requireMcpAuthenticationSession', () => {
  it('returns the session when the request is authenticated', () => {
    const authenticationSession = makeAuthenticatedSession();
    expect(requireMcpAuthenticationSession(toolContext(authenticationSession))).toBe(authenticationSession);
  });

  it('throws 401 when the context carries no session at all', () => {
    expectUnauthorized(() => requireMcpAuthenticationSession(toolContext(undefined)));
  });

  it('throws 401 for the unauthenticated sentinel', () => {
    expectUnauthorized(() => requireMcpAuthenticationSession(toolContext(invalidAuthenticationSession)));
  });

  it('accepts a resource context too', () => {
    const authenticationSession = makeAuthenticatedSession();
    const context: McpResourceContext = { requestId: 'req-1', logger: makeLogger(), uri: 'config://app', authenticationSession };
    expect(requireMcpAuthenticationSession(context)).toBe(authenticationSession);
  });
});
