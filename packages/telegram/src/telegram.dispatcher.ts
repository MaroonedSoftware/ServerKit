import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
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

  /** Dispatch a single update following the routing precedence described on the class. */
  async dispatchUpdate(update: TelegramUpdate): Promise<void> {
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
