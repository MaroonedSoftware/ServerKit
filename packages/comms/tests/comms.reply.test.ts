import { describe, it, expect } from 'vitest';
import { bindReply } from '../src/comms.reply.js';
import { makeRecordingNotifier } from './helpers.js';

describe('bindReply', () => {
  it('carries the notifier channel', () => {
    const { notifier } = makeRecordingNotifier('discord');
    expect(bindReply(notifier, 'C1').channel).toBe('discord');
  });

  it('delegates send/sendTemplate/sendNative with the bound recipient', async () => {
    const { notifier, calls } = makeRecordingNotifier('telegram');
    const reply = bindReply(notifier, 'chat-42');

    await reply.send({ text: 'hi' });
    await reply.sendTemplate('order.card', { id: 'O1' });
    await reply.sendNative({ raw: true });

    expect(calls).toEqual([
      { method: 'send', args: ['chat-42', { text: 'hi' }] },
      { method: 'sendTemplate', args: ['chat-42', 'order.card', { id: 'O1' }] },
      { method: 'sendNative', args: ['chat-42', { raw: true }] },
    ]);
  });
});
