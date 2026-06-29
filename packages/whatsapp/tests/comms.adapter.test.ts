import { describe, it, expect, vi } from 'vitest';
import { ChannelRouter, CommsError } from '@maroonedsoftware/comms';
import { dispatchWhatsApp, createWhatsAppNotifier } from '../src/comms.js';
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
  entry: [{ id: 'W1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PN1' }, contacts: [{ wa_id: '15551112222', profile: { name: 'Ada' } }], messages } as never }] }],
});

describe('whatsapp /comms adapter', () => {
  it('routes a /-prefixed text message as a command and replies via sendText', async () => {
    const router = new ChannelRouter();
    let got: unknown;
    router.command('deploy', async (event, reply) => { got = event.command; await reply.send({ text: 'ok' }); });
    const { client, sendText } = makeClient();

    await dispatchWhatsApp(router, client, webhook([{ from: '15551112222', id: 'm1', timestamp: '1', type: 'text', text: { body: '/deploy staging' } }]));

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

    await dispatchWhatsApp(router, client, webhook([
      { from: '15551112222', id: 'm3', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'confirm', title: 'Confirm' } } },
    ]));

    expect(handler.mock.calls[0]![0]).toMatchObject({ kind: 'action', action: { id: 'confirm', value: 'Confirm' } });
  });

  it('renders ≤3 buttons as an interactive button message', async () => {
    const router = new ChannelRouter();
    router.message(async (_e, reply) => reply.send({ text: 'pick', buttons: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }));
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
    expect(sendMessage).toHaveBeenCalledWith({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '15551112222', type: 'template', template: { name: 'card' } });

    await expect(notifier.sendTemplate('x', 'missing', {})).rejects.toBeInstanceOf(CommsError);
  });
});
