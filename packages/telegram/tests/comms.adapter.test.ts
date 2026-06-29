import { describe, it, expect, vi } from 'vitest';
import { ChannelRouter, CommsError } from '@maroonedsoftware/comms';
import { dispatchTelegram, createTelegramNotifier } from '../src/comms.js';
import type { TelegramClient } from '../src/client/telegram.client.js';
import type { TelegramUpdate } from '../src/telegram.update.handler.js';

const makeClient = () => {
  const sendMessage = vi.fn().mockResolvedValue({});
  const answerCallbackQuery = vi.fn().mockResolvedValue(true);
  return { client: { sendMessage, answerCallbackQuery } as unknown as TelegramClient, sendMessage, answerCallbackQuery };
};

const message = (text: string): TelegramUpdate => ({ update_id: 1, message: { message_id: 1, chat: { id: 42, type: 'private' }, date: 1, from: { id: 7, username: 'ada' }, text } });

describe('telegram /comms adapter', () => {
  it('routes a command and replies via sendMessage with the chat id', async () => {
    const router = new ChannelRouter();
    let got: unknown;
    router.command('deploy', async (event, reply) => { got = event.command; await reply.send({ text: 'ok' }); });
    const { client, sendMessage } = makeClient();

    await dispatchTelegram(router, client, message('/deploy staging'));

    expect(got).toEqual({ name: '/deploy', args: 'staging' });
    expect(sendMessage).toHaveBeenCalledWith({ chat_id: '42', text: 'ok' });
  });

  it('renders buttons as an inline keyboard', async () => {
    const router = new ChannelRouter();
    router.message(async (_e, reply) => reply.send({ text: 'pick', buttons: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }));
    const { client, sendMessage } = makeClient();

    await dispatchTelegram(router, client, message('hello'));

    const params = sendMessage.mock.calls[0]![0] as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } };
    expect(params.reply_markup.inline_keyboard[0]!.map(b => b.callback_data)).toEqual(['a', 'b']);
  });

  it('routes a callback_query as an action and answers it', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.action('vote:yes', handler);
    const { client, answerCallbackQuery } = makeClient();

    await dispatchTelegram(router, client, { update_id: 2, callback_query: { id: 'cq1', from: { id: 7 }, data: 'vote:yes', message: { message_id: 1, chat: { id: 42, type: 'private' }, date: 1 } } });

    expect(handler.mock.calls[0]![0]).toMatchObject({ kind: 'action', action: { id: 'vote:yes' }, conversation: { id: '42' } });
    expect(answerCallbackQuery).toHaveBeenCalledWith({ callback_query_id: 'cq1' });
  });

  it('routes plain text as a message', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.message(handler);
    const { client } = makeClient();
    await dispatchTelegram(router, client, message('just chatting'));
    expect(handler.mock.calls[0]![0]).toMatchObject({ kind: 'message', text: 'just chatting', user: { id: '7', username: 'ada' } });
  });

  it('ignores updates with no message or callback data', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.message(handler);
    const { client } = makeClient();
    await dispatchTelegram(router, client, { update_id: 3, my_chat_member: {} } as TelegramUpdate);
    expect(handler).not.toHaveBeenCalled();
  });

  it('createTelegramNotifier.sendTemplate renders native then throws for unknown names', async () => {
    const router = new ChannelRouter();
    router.templates.register('card', 'telegram', (d: { id: string }) => ({ text: `card ${d.id}`, parse_mode: 'MarkdownV2' }));
    const { client, sendMessage } = makeClient();
    const notifier = createTelegramNotifier(client, router.templates);

    await notifier.sendTemplate('42', 'card', { id: 'O1' });
    expect(sendMessage).toHaveBeenCalledWith({ chat_id: '42', text: 'card O1', parse_mode: 'MarkdownV2' });

    await expect(notifier.sendTemplate('42', 'missing', {})).rejects.toBeInstanceOf(CommsError);
  });
});
