import { describe, it, expect, vi } from 'vitest';
import { ChannelRouter, CommsError, type IncomingEvent, type OutgoingMessage, type Reply } from '@maroonedsoftware/comms';
import { dispatchWhatsApp, createWhatsAppNotifier, normalizeWhatsAppMessage } from '../src/comms.js';
import type { WhatsAppClient } from '../src/client/whatsapp.client.js';
import type { WhatsAppWebhookBody } from '../src/whatsapp.message.handler.js';

const makeClient = () => {
  const sendText = vi.fn().mockResolvedValue({});
  const sendInteractive = vi.fn().mockResolvedValue({});
  const sendMessage = vi.fn().mockResolvedValue({});
  return { client: { sendText, sendInteractive, sendMessage } as unknown as WhatsAppClient, sendText, sendInteractive, sendMessage };
};

const webhook = (messages: unknown[]): WhatsAppWebhookBody => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'W1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'PN1' },
            contacts: [{ wa_id: '15551112222', profile: { name: 'Ada' } }],
            messages,
          } as never,
        },
      ],
    },
  ],
});

describe('whatsapp /comms adapter', () => {
  it('routes a /-prefixed text message as a command and replies via sendText', async () => {
    const router = new ChannelRouter();
    let got: unknown;
    router.command('deploy', async (event, reply) => {
      got = event.command;
      await reply.send({ text: 'ok' });
    });
    const { client, sendText } = makeClient();

    await dispatchWhatsApp(
      router,
      client,
      webhook([{ from: '15551112222', id: 'm1', timestamp: '1', type: 'text', text: { body: '/deploy staging' } }]),
    );

    expect(got).toEqual({ name: '/deploy', args: 'staging' });
    expect(sendText).toHaveBeenCalledWith('15551112222', 'ok');
  });

  it('routes plain text as a message with the contact name', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.message(handler);
    const { client } = makeClient();

    await dispatchWhatsApp(router, client, webhook([{ from: '15551112222', id: 'm2', timestamp: '1', type: 'text', text: { body: 'hello' } }]));

    expect(handler.mock.calls[0]![0]).toMatchObject({ kind: 'message', text: 'hello', user: { id: '15551112222', username: 'Ada' } });
  });

  it('routes an interactive button reply as an action', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.action('confirm', handler);
    const { client } = makeClient();

    await dispatchWhatsApp(
      router,
      client,
      webhook([
        {
          from: '15551112222',
          id: 'm3',
          timestamp: '1',
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'confirm', title: 'Confirm' } },
        },
      ]),
    );

    expect(handler.mock.calls[0]![0]).toMatchObject({ kind: 'action', action: { id: 'confirm', value: 'Confirm' } });
  });

  it('renders ≤3 buttons as an interactive button message', async () => {
    const router = new ChannelRouter();
    router.message(async (_e, reply) =>
      reply.send({
        text: 'pick',
        buttons: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      }),
    );
    const { client, sendInteractive } = makeClient();

    await dispatchWhatsApp(router, client, webhook([{ from: '15551112222', id: 'm4', timestamp: '1', type: 'text', text: { body: 'hi' } }]));

    const [to, interactive] = sendInteractive.mock.calls[0]! as [string, { type: string; action: { buttons: unknown[] } }];
    expect(to).toBe('15551112222');
    expect(interactive.type).toBe('button');
    expect(interactive.action.buttons).toHaveLength(2);
  });

  it('degrades >3 buttons to an interactive list', async () => {
    const router = new ChannelRouter();
    const buttons = ['a', 'b', 'c', 'd'].map(id => ({ id, label: id.toUpperCase() }));
    router.message(async (_e, reply) => reply.send({ text: 'pick', buttons }));
    const { client, sendInteractive } = makeClient();

    await dispatchWhatsApp(router, client, webhook([{ from: '15551112222', id: 'm5', timestamp: '1', type: 'text', text: { body: 'hi' } }]));

    const interactive = (sendInteractive.mock.calls[0]! as [string, { type: string }])[1];
    expect(interactive.type).toBe('list');
  });

  it('skips media messages (left to native handlers)', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.message(handler);
    const { client } = makeClient();
    await dispatchWhatsApp(router, client, webhook([{ from: '15551112222', id: 'm6', timestamp: '1', type: 'image' }]));
    expect(handler).not.toHaveBeenCalled();
  });

  it('createWhatsAppNotifier.sendTemplate renders native then throws for unknown names', async () => {
    const router = new ChannelRouter();
    router.templates.register('card', 'whatsapp', () => ({ type: 'template', template: { name: 'card' } }));
    const { client, sendMessage } = makeClient();
    const notifier = createWhatsAppNotifier(client, router.templates);

    await notifier.sendTemplate('15551112222', 'card', {});
    expect(sendMessage).toHaveBeenCalledWith({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15551112222',
      type: 'template',
      template: { name: 'card' },
    });

    await expect(notifier.sendTemplate('x', 'missing', {})).rejects.toBeInstanceOf(CommsError);
  });
});

describe('whatsapp /comms normalizer and dispatch options', () => {
  const value = webhook([]).entry![0]!.changes![0]!.value;

  it('normalizeWhatsAppMessage normalizes text and returns undefined for media', () => {
    expect(normalizeWhatsAppMessage({ from: '15551112222', id: 'm1', timestamp: '1', type: 'text', text: { body: 'hi' } }, value)).toMatchObject({
      channel: 'whatsapp',
      kind: 'message',
      text: 'hi',
      user: { id: '15551112222', username: 'Ada' },
      conversation: { id: '15551112222' },
    });
    expect(normalizeWhatsAppMessage({ from: '15551112222', id: 'm2', timestamp: '1', type: 'image' }, value)).toBeUndefined();
  });

  it('builds replies with options.reply instead of sending inline', async () => {
    const router = new ChannelRouter();
    router.message(async (_e, reply) => reply.send({ text: 'queued' }));
    const { client, sendText } = makeClient();
    const queued: unknown[] = [];
    const reply = vi.fn((to: string, _event: IncomingEvent): Reply => ({
      channel: 'whatsapp',
      send: async message => void queued.push({ to, message }),
      sendTemplate: async () => {},
      sendNative: async () => {},
    }));

    await dispatchWhatsApp(router, client, webhook([{ from: '15551112222', id: 'm7', timestamp: '1', type: 'text', text: { body: 'hi' } }]), {
      reply,
    });

    expect(reply.mock.calls[0]![1]).toMatchObject({ kind: 'message', text: 'hi' });
    expect(queued).toEqual([{ to: '15551112222', message: { text: 'queued' } }]);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('hands unrouted messages to onUnsupported with a reply to the sender', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.message(handler);
    const { client, sendText } = makeClient();
    const onUnsupported = vi.fn(async (_m: unknown, _v: unknown, reply: Reply) => reply.send({ text: 'I can only read text messages' }));

    await dispatchWhatsApp(router, client, webhook([{ from: '15551112222', id: 'm8', timestamp: '1', type: 'image' }]), { onUnsupported });

    expect(handler).not.toHaveBeenCalled();
    expect(onUnsupported.mock.calls[0]![0]).toMatchObject({ id: 'm8', type: 'image' });
    expect(onUnsupported.mock.calls[0]![1]).toMatchObject({ metadata: { phone_number_id: 'PN1' } });
    expect(sendText).toHaveBeenCalledWith('15551112222', 'I can only read text messages');
  });
});

describe('whatsapp /comms message id and group', () => {
  const value = webhook([]).entry![0]!.changes![0]!.value;

  it('carries the message id on every routed kind', () => {
    const text = normalizeWhatsAppMessage({ from: '15551112222', id: 'wamid.A', timestamp: '1', type: 'text', text: { body: 'hi' } }, value);
    const command = normalizeWhatsAppMessage({ from: '15551112222', id: 'wamid.B', timestamp: '1', type: 'text', text: { body: '/help' } }, value);
    const action = normalizeWhatsAppMessage(
      { from: '15551112222', id: 'wamid.C', timestamp: '1', type: 'button', button: { payload: 'yes', text: 'Yes' } },
      value,
    );
    expect([text?.messageId, command?.messageId, action?.messageId]).toEqual(['wamid.A', 'wamid.B', 'wamid.C']);
  });

  it('flags group messages and leaves direct messages unflagged', () => {
    const group = normalizeWhatsAppMessage(
      { from: '15551112222', id: 'm1', timestamp: '1', type: 'text', text: { body: 'hi' }, group_id: 'G1' },
      value,
    );
    const direct = normalizeWhatsAppMessage({ from: '15551112222', id: 'm2', timestamp: '1', type: 'text', text: { body: 'hi' } }, value);
    expect(group?.conversation).toEqual({ id: '15551112222', group: true });
    expect(direct?.conversation).toEqual({ id: '15551112222' });
  });
});

describe('whatsapp /comms truncation to Cloud API limits', () => {
  const send = async (message: OutgoingMessage) => {
    const router = new ChannelRouter();
    router.message(async (_e, reply) => reply.send(message));
    const mocks = makeClient();
    await dispatchWhatsApp(router, mocks.client, webhook([{ from: '15551112222', id: 'm1', timestamp: '1', type: 'text', text: { body: 'hi' } }]));
    return mocks;
  };

  it('truncates a plain text body to 4096 characters with an ellipsis', async () => {
    const { sendText } = await send({ text: 'x'.repeat(5000) });
    const body = sendText.mock.calls[0]![1] as string;
    expect(body).toHaveLength(4096);
    expect(body.endsWith('x…')).toBe(true);
  });

  it('leaves text at the limit untouched', async () => {
    const { sendText } = await send({ text: 'x'.repeat(4096) });
    expect(sendText.mock.calls[0]![1]).toBe('x'.repeat(4096));
  });

  it('truncates the interactive body to 1024 and reply button titles to 20', async () => {
    const { sendInteractive } = await send({ text: 'y'.repeat(2000), buttons: [{ id: 'a', label: 'A very long button label indeed' }] });
    const interactive = sendInteractive.mock.calls[0]![1] as {
      body: { text: string };
      action: { buttons: { reply: { id: string; title: string } }[] };
    };
    expect(interactive.body.text).toHaveLength(1024);
    expect(interactive.body.text.endsWith('…')).toBe(true);
    expect(interactive.action.buttons[0]!.reply).toEqual({ id: 'a', title: 'A very long button …' });
  });

  it('truncates list row titles to 24', async () => {
    const buttons = ['a', 'b', 'c', 'd'].map(id => ({ id, label: `Option ${id} with a rather long label` }));
    const { sendInteractive } = await send({ text: 'pick', buttons });
    const interactive = sendInteractive.mock.calls[0]![1] as { action: { sections: { rows: { title: string }[] }[] } };
    const titles = interactive.action.sections[0]!.rows.map(r => r.title);
    expect(titles[0]).toBe('Option a with a rather …');
    expect(titles.every(t => Array.from(t).length <= 24)).toBe(true);
  });

  it('never splits an emoji when truncating', async () => {
    const { sendInteractive } = await send({ text: 'pick', buttons: [{ id: 'a', label: '😀'.repeat(25) }] });
    const interactive = sendInteractive.mock.calls[0]![1] as { action: { buttons: { reply: { title: string } }[] } };
    expect(interactive.action.buttons[0]!.reply.title).toBe(`${'😀'.repeat(19)}…`);
  });
});
