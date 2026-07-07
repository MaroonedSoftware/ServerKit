import { describe, it, expect, vi } from 'vitest';
import { ChannelRouter, CommsError } from '@maroonedsoftware/comms';
import { dispatchDiscord, createDiscordNotifier } from '../src/comms.js';
import { InteractionType, InteractionCallbackType } from '../src/discord.interaction.handler.js';
import type { DiscordClient } from '../src/client/discord.client.js';

const makeClient = () => {
  const createMessage = vi.fn().mockResolvedValue({});
  const createFollowupMessage = vi.fn().mockResolvedValue({});
  const createInteractionResponse = vi.fn().mockResolvedValue({});
  return {
    client: { createMessage, createFollowupMessage, createInteractionResponse } as unknown as DiscordClient,
    createMessage,
    createFollowupMessage,
    createInteractionResponse,
  };
};

const base = { id: 'i1', token: 'tok', application_id: 'app1' };

describe('discord /comms adapter', () => {
  it('answers PING with PONG', async () => {
    const { client } = makeClient();
    expect(await dispatchDiscord(new ChannelRouter(), client, { ...base, type: InteractionType.PING } as never)).toEqual({ type: InteractionCallbackType.PONG });
  });

  it('routes an application command (joining option values into args) and returns the first reply as the callback', async () => {
    const router = new ChannelRouter();
    let got: unknown;
    router.command('deploy', async (event, reply) => {
      got = event.command;
      await reply.send({ text: 'Deploying…', buttons: [{ id: 'deploy:confirm', label: 'Confirm' }] });
    });
    const { client, createFollowupMessage } = makeClient();

    const result = await dispatchDiscord(router, client, {
      ...base, type: InteractionType.APPLICATION_COMMAND, channel_id: 'C1',
      member: { user: { id: 'U1', username: 'ada' } },
      data: { name: 'deploy', options: [{ name: 'env', value: 'staging' }] },
    } as never);

    expect(got).toEqual({ name: 'deploy', args: 'staging' });
    expect(result).toMatchObject({ type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE });
    const data = (result as { data: { content: string; components: Array<{ components: Array<{ custom_id: string }> }> } }).data;
    expect(data.content).toBe('Deploying…');
    expect(data.components[0]!.components[0]!.custom_id).toBe('deploy:confirm');
    expect(createFollowupMessage).not.toHaveBeenCalled();
  });

  it('acknowledges the interaction before followups when the handler replies twice', async () => {
    const router = new ChannelRouter();
    router.command('deploy', async (_e, reply) => {
      await reply.send({ text: 'first' });
      await reply.send({ text: 'second' });
    });
    const { client, createInteractionResponse, createFollowupMessage } = makeClient();

    const result = await dispatchDiscord(router, client, { ...base, type: InteractionType.APPLICATION_COMMAND, data: { name: 'deploy' } } as never);

    // The interaction is acked out of band with the first reply, so the route
    // gets no callback to serialize (and must not double-ack).
    expect(result).toBeUndefined();
    expect(createInteractionResponse).toHaveBeenCalledOnce();
    expect(createInteractionResponse).toHaveBeenCalledWith('i1', 'tok', {
      type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'first', allowed_mentions: { parse: [] } },
    });
    // The second reply is a valid followup, sent after the ack.
    expect(createFollowupMessage).toHaveBeenCalledOnce();
    expect(createFollowupMessage).toHaveBeenCalledWith('tok', { content: 'second', allowed_mentions: { parse: [] } });
    expect(createInteractionResponse.mock.invocationCallOrder[0]!).toBeLessThan(createFollowupMessage.mock.invocationCallOrder[0]!);
  });

  it('restricts allowed_mentions so user text cannot trigger @everyone pings', async () => {
    const router = new ChannelRouter();
    router.command('say', async (_e, reply) => reply.send({ text: 'hey @everyone ship it' }));
    const { client } = makeClient();

    const result = await dispatchDiscord(router, client, { ...base, type: InteractionType.APPLICATION_COMMAND, data: { name: 'say' } } as never);

    const data = (result as { data: { content: string; allowed_mentions: { parse: unknown[] } } }).data;
    expect(data.content).toBe('hey @everyone ship it');
    expect(data.allowed_mentions).toEqual({ parse: [] });
  });

  it('routes a message component by custom_id', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.action('deploy:confirm', handler);
    const { client } = makeClient();

    await dispatchDiscord(router, client, {
      ...base, type: InteractionType.MESSAGE_COMPONENT, user: { id: 'U2', username: 'bob' },
      data: { custom_id: 'deploy:confirm', component_type: 2 },
    } as never);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toMatchObject({ kind: 'action', action: { id: 'deploy:confirm' }, user: { id: 'U2' } });
  });

  it('returns undefined for an unrouted interaction', async () => {
    const { client } = makeClient();
    const result = await dispatchDiscord(new ChannelRouter(), client, { ...base, type: InteractionType.MODAL_SUBMIT, data: { custom_id: 'x' } } as never);
    expect(result).toBeUndefined();
  });

  it('createDiscordNotifier.sendTemplate renders native then throws for unknown names', async () => {
    const router = new ChannelRouter();
    router.templates.register('card', 'discord', (d: { id: string }) => ({ content: `card ${d.id}` }));
    const { client, createMessage } = makeClient();
    const notifier = createDiscordNotifier(client, router.templates);

    await notifier.sendTemplate('C1', 'card', { id: 'O1' });
    expect(createMessage).toHaveBeenCalledWith('C1', { content: 'card O1' });

    await expect(notifier.sendTemplate('C1', 'missing', {})).rejects.toBeInstanceOf(CommsError);
  });
});
