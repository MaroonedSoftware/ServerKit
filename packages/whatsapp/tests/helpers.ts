import { vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Logger } from '@maroonedsoftware/logger';

export const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

/** Produces the `sha256=`-prefixed HMAC Meta sends as `X-Hub-Signature-256`. */
export const signBody = (rawBody: string, appSecret: string): string => `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
