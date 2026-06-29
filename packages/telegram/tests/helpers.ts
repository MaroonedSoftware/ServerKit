import { vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

export const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});
