import { describe, it, expect, vi } from 'vitest';
import { ChannelRouter, CommsError } from '@maroonedsoftware/comms';
import { dispatchSlackEvent, dispatchSlackCommand, dispatchSlackInteraction, createSlackNotifier } from '../src/comms.js';
import type { SlackClient } from '../src/client/slack.client.js';

const makeClient = () => {
  const postMessage = vi.fn().mockResolvedValue({ ok: true });
  const postWebhook = vi.fn().mockResolvedValue(undefined);
  return { client: { postMessage, postWebhook } as unknown as SlackClient, postMessage, postWebhook };
};

describe('slack /comms adapter', () => {
  it('returns the url_verification challenge', async () => {
    const { client } = makeClient();
    const result = await dispatchSlackEvent(new ChannelRouter(), client, { type: 'url_verification', challenge: 'c123' } as never);
    expect(result).toEqual({ challenge: 'c123' });
  });

  it('routes a message event and replies via postMessage to the channel', async () => {
    const router = new ChannelRouter();
    router.message(async (event, reply) => {
      expect(event).toMatchObject({ kind: 'message', text: 'yo', user: { id: 'U1' }, conversation: { id: 'C9' } });
      await reply.send({ text: 'hi', buttons: [{ id: 'b1', label: 'B' }] });
    });
    const { client, postMessage } = makeClient();

    await dispatchSlackEvent(router, client, {
      type: 'event_callback', team_id: 'T', api_app_id: 'A', event_id: 'E', event_time: 1,
      event: { type: 'message', user: 'U1', channel: 'C9', text: 'yo' },
    } as never);

    const arg = postMessage.mock.calls[0]![0] as { channel: string; blocks: Array<{ elements?: Array<{ action_id: string }> }> };
    expect(arg.channel).toBe('C9');
    expect(arg.blocks[1]!.elements![0]!.action_id).toBe('b1');
  });

  it('skips the bot’s own message events (no loop)', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.message(handler);
    const { client } = makeClient();
    await dispatchSlackEvent(router, client, {
      type: 'event_callback', team_id: 'T', api_app_id: 'A', event_id: 'E', event_time: 1,
      event: { type: 'message', user: 'U1', channel: 'C9', text: 'echo', bot_id: 'B1' },
    } as never);
    expect(handler).not.toHaveBeenCalled();
  });

  it('routes a slash command and replies via response_url', async () => {
    const router = new ChannelRouter();
    let got: unknown;
    router.command('deploy', async (event, reply) => { got = event.command; await reply.send({ text: 'ok' }); });
    const { client, postWebhook } = makeClient();

    await dispatchSlackCommand(router, client, {
      command: '/deploy', text: 'staging', user_id: 'U1', user_name: 'ada', channel_id: 'C1',
      response_url: 'https://hooks.slack.com/x', trigger_id: 't', token: '', team_id: 'T', team_domain: 'd',
    } as never);

    expect(got).toEqual({ name: '/deploy', args: 'staging' });
    expect(postWebhook).toHaveBeenCalledWith({ text: 'ok' }, 'https://hooks.slack.com/x');
  });

  it('routes a block_actions interaction by action_id', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.action('approve', handler);
    const { client } = makeClient();

    await dispatchSlackInteraction(router, client, {
      type: 'block_actions', user: { id: 'U1', name: 'ada' }, channel: { id: 'C1' },
      response_url: 'https://hooks.slack.com/y', actions: [{ action_id: 'approve', value: 'v' }],
    } as never);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toMatchObject({ kind: 'action', action: { id: 'approve', value: 'v' } });
  });

  it('ignores non-block_actions interactions (modals stay native)', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.action('x', handler);
    const { client } = makeClient();
    await dispatchSlackInteraction(router, client, { type: 'view_submission', view: { id: 'V', callback_id: 'x' } } as never);
    expect(handler).not.toHaveBeenCalled();
  });

  it('createSlackNotifier.sendTemplate uses a native renderer then throws for unknown names', async () => {
    const router = new ChannelRouter();
    router.templates.register('card', 'slack', (d: { id: string }) => ({ blocks: [{ id: d.id }] }));
    const { client, postMessage } = makeClient();
    const notifier = createSlackNotifier(client, router.templates);

    await notifier.sendTemplate('C1', 'card', { id: 'O1' });
    expect(postMessage).toHaveBeenCalledWith({ channel: 'C1', blocks: [{ id: 'O1' }] });

    await expect(notifier.sendTemplate('C1', 'missing', {})).rejects.toBeInstanceOf(CommsError);
  });
});
