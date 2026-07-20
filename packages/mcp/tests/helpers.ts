import { vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { createMcpRequestContext, type McpRequestContext } from '../src/mcp.request.context.js';

export const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

/** Builds a request context suitable for driving the dispatcher in tests. */
export const makeContext = (logger: Logger = makeLogger()): McpRequestContext => createMcpRequestContext({ requestId: 'req-1', logger });
