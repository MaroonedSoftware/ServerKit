import { vi } from 'vitest';
import { invalidAuthenticationSession, type AuthenticationSession } from '@maroonedsoftware/authentication';
import type { Logger } from '@maroonedsoftware/logger';
import { createMcpRequestContext, type CreateMcpRequestContextInput, type McpRequestContext } from '../src/mcp.request.context.js';

export const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

/**
 * An authenticated session for tests. Spreading the sentinel yields a distinct
 * object, so the identity check in `requireMcpAuthenticationSession` treats it
 * as authenticated, without constructing Luxon values here.
 */
export const makeAuthenticatedSession = (): AuthenticationSession => ({
  ...invalidAuthenticationSession,
  subject: 'user-1',
  sessionToken: 'tok-1',
});

/** Builds a request context suitable for driving the dispatcher in tests. */
export const makeContext = (overrides: Partial<CreateMcpRequestContextInput> = {}): McpRequestContext =>
  createMcpRequestContext({ requestId: 'req-1', logger: makeLogger(), ...overrides });
