import { describe, it, expect, vi } from 'vitest';
import { DiscordInteractionHandlerMap, DiscordDispatcher } from '../src/discord.dispatcher.js';
import { InteractionType, InteractionCallbackType, type DiscordInteraction } from '../src/discord.interaction.handler.js';
import { makeLogger } from './helpers.js';

const makeDispatcher = () => {
  const interactions = new DiscordInteractionHandlerMap();
  const logger = makeLogger();
  return { dispatcher: new DiscordDispatcher(interactions, logger), interactions, logger };
};

const base = { id: 'i1', token: 'tok', application_id: 'app1' };

describe('DiscordDispatcher.dispatchInteraction', () => {
  it('responds to a PING with a PONG', async () => {
    const { dispatcher } = makeDispatcher();
    const result = await dispatcher.dispatchInteraction({ ...base, type: InteractionType.PING });
    expect(result).toEqual({ type: InteractionCallbackType.PONG });
  });

  it('routes an application command by name and forwards the response', async () => {
    const { dispatcher, interactions } = makeDispatcher();
    interactions.set('command:deploy', { handle: vi.fn().mockResolvedValue({ type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'ok' } }) });
    const result = await dispatcher.dispatchInteraction({ ...base, type: InteractionType.APPLICATION_COMMAND, data: { name: 'deploy' } });
    expect(result).toEqual({ type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'ok' } });
  });

  it('builds a context with the resolved user and envelope fields', async () => {
    const { dispatcher, interactions } = makeDispatcher();
    const handler = { handle: vi.fn().mockResolvedValue(undefined) };
    interactions.set('command:deploy', handler);
    const interaction: DiscordInteraction = {
      ...base,
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: 'G1',
      channel_id: 'C1',
      member: { user: { id: 'U1', username: 'alice' } },
      data: { name: 'deploy' },
    };
    await dispatcher.dispatchInteraction(interaction);

    expect(handler.handle).toHaveBeenCalledOnce();
    const [passedInteraction, ctx] = handler.handle.mock.calls[0]!;
    expect(passedInteraction).toBe(interaction);
    expect(ctx).toMatchObject({ applicationId: 'app1', interactionId: 'i1', token: 'tok', guildId: 'G1', channelId: 'C1', user: { id: 'U1', username: 'alice' } });
    expect(ctx.interaction).toBe(interaction);
  });

  it('falls back to the DM user object when there is no member', async () => {
    const { dispatcher, interactions } = makeDispatcher();
    const handler = { handle: vi.fn().mockResolvedValue(undefined) };
    interactions.set('component:vote', handler);
    await dispatcher.dispatchInteraction({ ...base, type: InteractionType.MESSAGE_COMPONENT, user: { id: 'U9', username: 'bob' }, data: { custom_id: 'vote' } });
    const [, ctx] = handler.handle.mock.calls[0]!;
    expect(ctx.user).toEqual({ id: 'U9', username: 'bob' });
  });

  it('routes a modal submit by custom_id', async () => {
    const { dispatcher, interactions } = makeDispatcher();
    const handler = { handle: vi.fn().mockResolvedValue(undefined) };
    interactions.set('modal:create_ticket', handler);
    await dispatcher.dispatchInteraction({ ...base, type: InteractionType.MODAL_SUBMIT, data: { custom_id: 'create_ticket' } });
    expect(handler.handle).toHaveBeenCalledOnce();
  });

  it('routes an autocomplete by name', async () => {
    const { dispatcher, interactions } = makeDispatcher();
    const handler = { handle: vi.fn().mockResolvedValue({ type: InteractionCallbackType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: [] } }) };
    interactions.set('autocomplete:search', handler);
    const result = await dispatcher.dispatchInteraction({ ...base, type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE, data: { name: 'search' } });
    expect(result).toMatchObject({ type: InteractionCallbackType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT });
  });

  it('returns undefined and logs when no routing key can be derived', async () => {
    const { dispatcher, logger } = makeDispatcher();
    const result = await dispatcher.dispatchInteraction({ ...base, type: InteractionType.APPLICATION_COMMAND, data: {} });
    expect(result).toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('returns undefined and logs when no handler is registered for the key', async () => {
    const { dispatcher, logger } = makeDispatcher();
    const result = await dispatcher.dispatchInteraction({ ...base, type: InteractionType.APPLICATION_COMMAND, data: { name: 'unknown' } });
    expect(result).toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('returns undefined when a handler returns void', async () => {
    const { dispatcher, interactions } = makeDispatcher();
    interactions.set('command:ack', { handle: vi.fn().mockResolvedValue(undefined) });
    expect(await dispatcher.dispatchInteraction({ ...base, type: InteractionType.APPLICATION_COMMAND, data: { name: 'ack' } })).toBeUndefined();
  });
});
