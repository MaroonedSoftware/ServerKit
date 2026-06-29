import { vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { IncomingEvent } from '../src/comms.event.js';
import type { Notifier, Reply } from '../src/comms.reply.js';

export const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

/** A Reply whose calls are recorded, for asserting what a handler sent. */
export const makeRecordingReply = (channel = 'slack') => {
  const sent: Array<{ method: string; args: unknown[] }> = [];
  const reply: Reply = {
    channel,
    send: async (...args) => void sent.push({ method: 'send', args }),
    sendTemplate: async (...args) => void sent.push({ method: 'sendTemplate', args }),
    sendNative: async (...args) => void sent.push({ method: 'sendNative', args }),
  };
  return { reply, sent };
};

/** A Notifier that records every call, for testing bindReply. */
export const makeRecordingNotifier = (channel = 'telegram') => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const notifier: Notifier = {
    channel,
    send: async (...args) => void calls.push({ method: 'send', args }),
    sendTemplate: async (...args) => void calls.push({ method: 'sendTemplate', args }),
    sendNative: async (...args) => void calls.push({ method: 'sendNative', args }),
  };
  return { notifier, calls };
};

export const event = (over: Partial<IncomingEvent> & Pick<IncomingEvent, 'kind'>): IncomingEvent => ({
  channel: 'slack',
  user: { id: 'U1' },
  conversation: { id: 'C1' },
  raw: {},
  ...over,
});
