import { describe, it, expect, vi } from 'vitest';
import type { IdempotencyOutcome, IdempotencyStore } from '@maroonedsoftware/cache';
import {
  TelegramCommandHandlerMap,
  TelegramCallbackQueryHandlerMap,
  TelegramUpdateHandlerMap,
  TelegramDispatcher,
  telegramUpdateIdempotencyKey,
} from '../src/telegram.dispatcher.js';
import type { TelegramMessage, TelegramUpdate } from '../src/telegram.update.handler.js';
import { makeLogger } from './helpers.js';

/**
 * Minimal in-memory {@link IdempotencyStore}: the first call for a key runs `work`
 * (`processed`), any later call for the same key is a `duplicate` and skips `work`.
 */
const makeIdempotencyStub = (): IdempotencyStore => {
  const seen = new Set<string>();
  return {
    deduplicate: async <T>(key: string, work: () => Promise<T>): Promise<IdempotencyOutcome<T>> => {
      if (seen.has(key)) return { status: 'duplicate' };
      seen.add(key);
      return { status: 'processed', result: await work() };
    },
  };
};

const makeDispatcher = () => {
  const commands = new TelegramCommandHandlerMap();
  const callbackQueries = new TelegramCallbackQueryHandlerMap();
  const updates = new TelegramUpdateHandlerMap();
  const logger = makeLogger();
  return { dispatcher: new TelegramDispatcher(commands, callbackQueries, updates, logger), commands, callbackQueries, updates, logger };
};

const message = (text: string): TelegramMessage => ({ message_id: 1, chat: { id: 42, type: 'private' }, date: 1, from: { id: 7, username: 'ada' }, text });

describe('TelegramDispatcher.dispatchUpdate', () => {
  it('routes a command message to the command map and parses args', async () => {
    const { dispatcher, commands } = makeDispatcher();
    const handler = { handle: vi.fn() };
    commands.set('/deploy', handler);

    await dispatcher.dispatchUpdate({ update_id: 100, message: message('/deploy staging') });

    expect(handler.handle).toHaveBeenCalledOnce();
    const [command, ctx] = handler.handle.mock.calls[0]!;
    expect(command).toMatchObject({ name: '/deploy', args: 'staging' });
    expect(ctx).toMatchObject({ updateId: 100, chatId: 42, from: { id: 7, username: 'ada' } });
  });

  it('routes a callback query by data', async () => {
    const { dispatcher, callbackQueries } = makeDispatcher();
    const handler = { handle: vi.fn() };
    callbackQueries.set('vote:yes', handler);

    await dispatcher.dispatchUpdate({ update_id: 101, callback_query: { id: 'cq1', from: { id: 7 }, data: 'vote:yes', message: message('poll') } });

    expect(handler.handle).toHaveBeenCalledOnce();
    const [cq, ctx] = handler.handle.mock.calls[0]!;
    expect(cq.data).toBe('vote:yes');
    expect(ctx.chatId).toBe(42);
  });

  it('routes a plain message to the update-type map', async () => {
    const { dispatcher, updates } = makeDispatcher();
    const handler = { handle: vi.fn() };
    updates.set('message', handler);

    await dispatcher.dispatchUpdate({ update_id: 102, message: message('just chatting') });

    expect(handler.handle).toHaveBeenCalledOnce();
  });

  it('falls back to the update-type map when a command has no registered handler', async () => {
    const { dispatcher, updates, logger } = makeDispatcher();
    const fallback = { handle: vi.fn() };
    updates.set('message', fallback);

    await dispatcher.dispatchUpdate({ update_id: 103, message: message('/unknown') });

    expect(fallback.handle).toHaveBeenCalledOnce();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('falls back to the update-type map when a callback query has no registered handler', async () => {
    const { dispatcher, updates } = makeDispatcher();
    const fallback = { handle: vi.fn() };
    updates.set('callback_query', fallback);

    await dispatcher.dispatchUpdate({ update_id: 104, callback_query: { id: 'cq2', from: { id: 7 }, data: 'unhandled' } });

    expect(fallback.handle).toHaveBeenCalledOnce();
  });

  it('routes a non-message update type (edited_message)', async () => {
    const { dispatcher, updates } = makeDispatcher();
    const handler = { handle: vi.fn() };
    updates.set('edited_message', handler);

    await dispatcher.dispatchUpdate({ update_id: 105, edited_message: message('edited') });

    expect(handler.handle).toHaveBeenCalledOnce();
  });

  it('logs and does nothing when nothing matches', async () => {
    const { dispatcher, logger } = makeDispatcher();
    await dispatcher.dispatchUpdate({ update_id: 106, message: message('plain') });
    expect(logger.debug).toHaveBeenCalled();
  });

  it('logs when the update has no recognisable type', async () => {
    const { dispatcher, logger } = makeDispatcher();
    await dispatcher.dispatchUpdate({ update_id: 107 } as TelegramUpdate);
    expect(logger.debug).toHaveBeenCalled();
  });

  it('derives a stable idempotency key from update_id', () => {
    expect(telegramUpdateIdempotencyKey({ update_id: 108 })).toBe('telegram:update:108');
  });

  it('routes an update once across identical redeliveries when idempotency is provided', async () => {
    const { dispatcher, updates } = makeDispatcher();
    const handler = { handle: vi.fn() };
    updates.set('message', handler);
    const idempotency = makeIdempotencyStub();

    const update: TelegramUpdate = { update_id: 200, message: message('hello') };
    await dispatcher.dispatchUpdate(update, { idempotency });
    await dispatcher.dispatchUpdate({ ...update }, { idempotency });

    expect(handler.handle).toHaveBeenCalledOnce();
  });

  it('routes every delivery when idempotency is not provided (unchanged behaviour)', async () => {
    const { dispatcher, updates } = makeDispatcher();
    const handler = { handle: vi.fn() };
    updates.set('message', handler);

    const update: TelegramUpdate = { update_id: 201, message: message('hello') };
    await dispatcher.dispatchUpdate(update);
    await dispatcher.dispatchUpdate({ ...update });

    expect(handler.handle).toHaveBeenCalledTimes(2);
  });
});
