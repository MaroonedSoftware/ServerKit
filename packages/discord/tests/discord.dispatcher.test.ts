import { describe, it, expect, vi } from 'vitest';
import type { IdempotencyStore, IdempotencyOutcome } from '@maroonedsoftware/cache';
import { DiscordInteractionHandlerMap, DiscordDispatcher } from '../src/discord.dispatcher.js';
import { InteractionType, InteractionCallbackType, type DiscordInteraction } from '../src/discord.interaction.handler.js';
import { makeLogger } from './helpers.js';

const makeDispatcher = () => {
  const interactions = new DiscordInteractionHandlerMap();
  const logger = makeLogger();
  return { dispatcher: new DiscordDispatcher(interactions, logger), interactions, logger };
};

const base = { id: 'i1', token: 'tok', application_id: 'app1' };

/**
 * In-memory {@link IdempotencyStore} stub: the first call for a key runs `work` and is
 * `processed`; every later call for the same key is a `duplicate` and never runs `work`.
 */
const makeIdempotencyStub = (): IdempotencyStore & { keys: string[] } => {
  const seen = new Set<string>();
  return {
    keys: [],
    async deduplicate<T>(key: string, work: () => Promise<T>): Promise<IdempotencyOutcome<T>> {
      (this as { keys: string[] }).keys.push(key);
      if (seen.has(key)) {
        return { status: 'duplicate' };
      }
      seen.add(key);
      return { status: 'processed', result: await work() };
    },
  };
};

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

  describe('with options.idempotency', () => {
    it('invokes the handler once for a duplicate interaction id and returns the response only the first time', async () => {
      const { dispatcher, interactions } = makeDispatcher();
      const handler = { handle: vi.fn().mockResolvedValue({ type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'ok' } }) };
      interactions.set('command:deploy', handler);
      const idempotency = makeIdempotencyStub();
      const interaction: DiscordInteraction = { ...base, type: InteractionType.APPLICATION_COMMAND, data: { name: 'deploy' } };

      const first = await dispatcher.dispatchInteraction(interaction, { idempotency });
      const second = await dispatcher.dispatchInteraction(interaction, { idempotency });

      expect(handler.handle).toHaveBeenCalledOnce();
      expect(first).toEqual({ type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'ok' } });
      expect(second).toBeUndefined();
      expect(idempotency.keys).toEqual(['discord:interaction:i1', 'discord:interaction:i1']);
    });

    it('never de-duplicates a PING — it always answers with a PONG and skips the store', async () => {
      const { dispatcher } = makeDispatcher();
      const idempotency = makeIdempotencyStub();
      const first = await dispatcher.dispatchInteraction({ ...base, type: InteractionType.PING }, { idempotency });
      const second = await dispatcher.dispatchInteraction({ ...base, type: InteractionType.PING }, { idempotency });
      expect(first).toEqual({ type: InteractionCallbackType.PONG });
      expect(second).toEqual({ type: InteractionCallbackType.PONG });
      expect(idempotency.keys).toEqual([]);
    });

    it('logs a warning and skips the handler on a dropped (dead-lettered) outcome', async () => {
      const { dispatcher, interactions, logger } = makeDispatcher();
      const handler = { handle: vi.fn() };
      interactions.set('command:deploy', handler);
      const idempotency: IdempotencyStore = {
        async deduplicate() {
          return { status: 'dropped', attempts: 5 };
        },
      };
      const result = await dispatcher.dispatchInteraction({ ...base, type: InteractionType.APPLICATION_COMMAND, data: { name: 'deploy' } }, { idempotency });
      expect(result).toBeUndefined();
      expect(handler.handle).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('is unchanged from the no-options path when idempotency is omitted', async () => {
      const { dispatcher, interactions } = makeDispatcher();
      const handler = { handle: vi.fn().mockResolvedValue({ type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'ok' } }) };
      interactions.set('command:deploy', handler);
      const interaction: DiscordInteraction = { ...base, type: InteractionType.APPLICATION_COMMAND, data: { name: 'deploy' } };
      const first = await dispatcher.dispatchInteraction(interaction);
      const second = await dispatcher.dispatchInteraction(interaction);
      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(first).toEqual({ type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'ok' } });
      expect(second).toEqual({ type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'ok' } });
    });
  });
});
