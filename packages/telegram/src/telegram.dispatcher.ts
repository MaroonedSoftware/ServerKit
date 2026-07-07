import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { IdempotencyStore } from '@maroonedsoftware/cache';
import {
  parseCommand,
  updateType,
  TelegramCallbackQueryHandler,
  TelegramCommandHandler,
  TelegramUpdateHandler,
  type TelegramUpdate,
  type TelegramUpdateContext,
} from './telegram.update.handler.js';

/**
 * Derives the stable idempotency key for a Telegram update: `telegram:update:{update_id}`.
 *
 * Telegram redelivers an update with the same `update_id` whenever the webhook
 * responds with a non-2xx status, so `update_id` is the natural de-duplication key.
 *
 * NOTE: `update_id` is only unique *per bot* — it is a sequence local to each bot's
 * update stream. In a multi-bot deployment the same `update_id` can appear for
 * different bots, so prefix a bot identifier (e.g. `telegram:{botId}:update:{update_id}`)
 * when sharing one {@link IdempotencyStore} across bots. This helper keys on
 * `update_id` alone; add the bot scope yourself if you need it.
 */
export const telegramUpdateIdempotencyKey = (update: TelegramUpdate): string => `telegram:update:${update.update_id}`;

/** Optional per-dispatch behaviour for {@link TelegramDispatcher.dispatchUpdate}. */
export interface TelegramDispatchOptions {
  /**
   * When provided, the whole update dispatch is wrapped in
   * {@link IdempotencyStore.deduplicate} keyed by {@link telegramUpdateIdempotencyKey},
   * so a Telegram redelivery of the same `update_id` is routed to the handlers at most
   * once. Omit it to keep the default at-least-once behaviour.
   */
  idempotency?: IdempotencyStore;
}

/**
 * Injectable map of command name (with slash, e.g. `/start`) →
 * {@link TelegramCommandHandler}.
 *
 * @example
 * ```ts
 * const commands = new TelegramCommandHandlerMap();
 * commands.set('/start', container.get(StartCommand));
 * container.register(TelegramCommandHandlerMap, { useValue: commands });
 * ```
 */
@Injectable()
export class TelegramCommandHandlerMap extends Map<string, TelegramCommandHandler> {}

/**
 * Injectable map of callback-query `data` → {@link TelegramCallbackQueryHandler}.
 * Keys match the developer-defined `data` set on inline-keyboard buttons.
 */
@Injectable()
export class TelegramCallbackQueryHandlerMap extends Map<string, TelegramCallbackQueryHandler> {}

/**
 * Injectable map of update type (`message`, `edited_message`, `inline_query`, …)
 * → {@link TelegramUpdateHandler}. Catches any update not consumed by a command
 * or callback-query handler.
 */
@Injectable()
export class TelegramUpdateHandlerMap extends Map<string, TelegramUpdateHandler> {}

/**
 * Single entry point for dispatching parsed Telegram updates to registered
 * handlers. Transport-agnostic: the consumer receives the HTTP request, verifies
 * the secret token, parses the JSON body, calls
 * {@link TelegramDispatcher.dispatchUpdate}, and acks `200`.
 *
 * Routing precedence for one update:
 * 1. A `message` whose text/caption is a command (`/…`) → {@link TelegramCommandHandlerMap}.
 * 2. A `callback_query` → {@link TelegramCallbackQueryHandlerMap} (by `data`).
 * 3. Anything else → {@link TelegramUpdateHandlerMap} (by update type).
 *
 * @example Koa route
 * ```ts
 * router.post('/telegram/webhook', async (ctx) => {
 *   const raw = await rawBody(ctx.req, { encoding: 'utf8' });
 *   verifyTelegramSecretToken({
 *     secretToken: ctx.container.get(TelegramConfig).secretToken!,
 *     headerValue: ctx.get('x-telegram-bot-api-secret-token'),
 *   });
 *   await ctx.container.get(TelegramDispatcher).dispatchUpdate(JSON.parse(raw));
 *   ctx.status = 200;
 * });
 * ```
 */
@Injectable()
export class TelegramDispatcher {
  constructor(
    private readonly commands: TelegramCommandHandlerMap,
    private readonly callbackQueries: TelegramCallbackQueryHandlerMap,
    private readonly updates: TelegramUpdateHandlerMap,
    private readonly logger: Logger,
  ) {}

  /**
   * Dispatch a single update following the routing precedence described on the class.
   *
   * Pass `options.idempotency` to de-duplicate Telegram redeliveries (same `update_id`):
   * the dispatch runs at most once per update, and a `duplicate`/`dropped` outcome is
   * skipped (returns void). Without it, behaviour is unchanged (at-least-once). The
   * dispatcher itself never answers callback queries, so wrapping the dispatch in
   * de-duplication cannot leave a callback spinner hanging on the first delivery.
   */
  async dispatchUpdate(update: TelegramUpdate, options?: TelegramDispatchOptions): Promise<void> {
    if (options?.idempotency) {
      await options.idempotency.deduplicate(telegramUpdateIdempotencyKey(update), () => this.route(update));
      return;
    }
    await this.route(update);
  }

  /** Routes an update to the matching handler. The retry-prone body de-duplicated by {@link dispatchUpdate}. */
  private async route(update: TelegramUpdate): Promise<void> {
    const context: TelegramUpdateContext = {
      updateId: update.update_id,
      chatId: update.message?.chat.id ?? update.callback_query?.message?.chat.id,
      from: update.message?.from ?? update.callback_query?.from,
      update,
    };

    if (update.message) {
      const command = parseCommand(update.message);
      if (command) {
        const handler = this.commands.get(command.name);
        if (handler) {
          await handler.handle(command, context);
          return;
        }
        this.logger.debug('No Telegram command handler registered', { command: command.name });
        // fall through to the update-type map so a generic message handler can still run
      }
    }

    if (update.callback_query) {
      const data = update.callback_query.data;
      const handler = data ? this.callbackQueries.get(data) : undefined;
      if (handler) {
        await handler.handle(update.callback_query, context);
        return;
      }
      this.logger.debug('No Telegram callback query handler registered', { data });
      // fall through to the update-type map
    }

    const type = updateType(update);
    if (!type) {
      this.logger.debug('Telegram update has no recognisable type', { updateId: update.update_id });
      return;
    }
    const handler = this.updates.get(type);
    if (!handler) {
      this.logger.debug('No Telegram update handler registered', { type });
      return;
    }
    await handler.handle(update, context);
  }
}
