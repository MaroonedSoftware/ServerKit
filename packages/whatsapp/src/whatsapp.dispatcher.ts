import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import {
  interactiveReplyId,
  WhatsAppInteractiveHandler,
  WhatsAppMessageHandler,
  WhatsAppStatusHandler,
  type WhatsAppMessage,
  type WhatsAppMessageContext,
  type WhatsAppStatus,
  type WhatsAppValue,
  type WhatsAppWebhookBody,
} from './whatsapp.message.handler.js';

/**
 * Injectable map of WhatsApp message `type` → {@link WhatsAppMessageHandler}.
 *
 * @example
 * ```ts
 * const messages = new WhatsAppMessageHandlerMap();
 * messages.set('text', container.get(TextMessageHandler));
 * container.register(WhatsAppMessageHandlerMap, { useValue: messages });
 * ```
 */
@Injectable()
export class WhatsAppMessageHandlerMap extends Map<string, WhatsAppMessageHandler> {}

/**
 * Injectable map of interactive reply id → {@link WhatsAppInteractiveHandler}.
 * Keys are the developer-defined ids produced by `interactiveReplyId(message)`.
 *
 * @example
 * ```ts
 * const interactives = new WhatsAppInteractiveHandlerMap();
 * interactives.set('confirm_order', container.get(ConfirmOrderHandler));
 * container.register(WhatsAppInteractiveHandlerMap, { useValue: interactives });
 * ```
 */
@Injectable()
export class WhatsAppInteractiveHandlerMap extends Map<string, WhatsAppInteractiveHandler> {}

/**
 * Injectable map of delivery status value (`sent`/`delivered`/`read`/`failed`) →
 * {@link WhatsAppStatusHandler}.
 */
@Injectable()
export class WhatsAppStatusHandlerMap extends Map<string, WhatsAppStatusHandler> {}

/**
 * Single entry point for dispatching parsed WhatsApp Cloud API webhook bodies to
 * registered handlers. Transport-agnostic: the consumer receives the HTTP
 * request, verifies the signature, parses the JSON body, calls
 * {@link WhatsAppDispatcher.dispatchWebhook}, and acks `200`.
 *
 * A webhook body is a batch — the dispatcher walks every entry → change → value,
 * dispatching each message and status. WhatsApp retries any non-2xx, so handlers
 * should ack quickly and offload slow work.
 *
 * @example Koa route (POST — message delivery)
 * ```ts
 * router.post('/whatsapp/webhook', async (ctx) => {
 *   const raw = await rawBody(ctx.req, { encoding: 'utf8' });
 *   verifyWhatsAppSignature({
 *     appSecret: ctx.container.get(WhatsAppConfig).appSecret,
 *     rawBody: raw,
 *     signature: ctx.get('x-hub-signature-256'),
 *   });
 *   await ctx.container.get(WhatsAppDispatcher).dispatchWebhook(JSON.parse(raw));
 *   ctx.status = 200;
 * });
 * ```
 */
@Injectable()
export class WhatsAppDispatcher {
  constructor(
    private readonly messages: WhatsAppMessageHandlerMap,
    private readonly interactives: WhatsAppInteractiveHandlerMap,
    private readonly statuses: WhatsAppStatusHandlerMap,
    private readonly logger: Logger,
  ) {}

  /**
   * Walks the batched webhook body, dispatching every message and status it
   * contains. Resolves once all handlers have settled.
   */
  async dispatchWebhook(body: WhatsAppWebhookBody): Promise<void> {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        for (const message of value.messages ?? []) {
          await this.dispatchMessage(message, entry.id, value);
        }
        for (const status of value.statuses ?? []) {
          await this.dispatchStatus(status, entry.id, value);
        }
      }
    }
  }

  /**
   * Dispatch a single message. Interactive and quick-reply-button messages are
   * routed by their developer-defined id ({@link WhatsAppInteractiveHandlerMap})
   * first; everything else (and id-less interactives with no specific handler)
   * falls back to the message-type map ({@link WhatsAppMessageHandlerMap}).
   */
  private async dispatchMessage(message: WhatsAppMessage, wabaId: string, value: WhatsAppValue): Promise<void> {
    const context: WhatsAppMessageContext = {
      phoneNumberId: value.metadata.phone_number_id,
      displayPhoneNumber: value.metadata.display_phone_number,
      wabaId,
      contact: value.contacts?.find(c => c.wa_id === message.from) ?? value.contacts?.[0],
      value,
    };

    const replyId = interactiveReplyId(message);
    if (replyId) {
      const interactive = this.interactives.get(replyId);
      if (interactive) {
        await interactive.handle(message, context);
        return;
      }
    }

    const handler = this.messages.get(message.type);
    if (!handler) {
      this.logger.debug('No WhatsApp message handler registered', { type: message.type, replyId });
      return;
    }
    await handler.handle(message, context);
  }

  /** Dispatch a single delivery status, keyed by `status.status`. */
  private async dispatchStatus(status: WhatsAppStatus, wabaId: string, value: WhatsAppValue): Promise<void> {
    const handler = this.statuses.get(status.status);
    if (!handler) {
      this.logger.debug('No WhatsApp status handler registered', { status: status.status });
      return;
    }
    await handler.handle(status, { phoneNumberId: value.metadata.phone_number_id, displayPhoneNumber: value.metadata.display_phone_number, wabaId, value });
  }
}
