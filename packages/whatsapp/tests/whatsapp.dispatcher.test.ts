import { describe, it, expect, vi } from 'vitest';
import type { IdempotencyOutcome, IdempotencyStore } from '@maroonedsoftware/cache';
import {
  WhatsAppMessageHandlerMap,
  WhatsAppInteractiveHandlerMap,
  WhatsAppStatusHandlerMap,
  WhatsAppDispatcher,
} from '../src/whatsapp.dispatcher.js';
import {
  interactiveReplyId,
  whatsappMessageIdempotencyKey,
  whatsappStatusIdempotencyKey,
  type WhatsAppMessage,
  type WhatsAppStatus,
  type WhatsAppWebhookBody,
} from '../src/whatsapp.message.handler.js';
import { makeLogger } from './helpers.js';

/**
 * Minimal in-memory {@link IdempotencyStore}: the first caller for a key runs
 * `work`, every later caller for that key is a `duplicate`. Enough to prove the
 * dispatcher runs each per-item handler at most once per key.
 */
const makeIdempotencyStore = (): IdempotencyStore => {
  const seen = new Set<string>();
  return {
    async deduplicate<T>(key: string, work: () => Promise<T>): Promise<IdempotencyOutcome<T>> {
      if (seen.has(key)) return { status: 'duplicate' };
      seen.add(key);
      return { status: 'processed', result: await work() };
    },
  };
};

const makeDispatcher = () => {
  const messages = new WhatsAppMessageHandlerMap();
  const interactives = new WhatsAppInteractiveHandlerMap();
  const statuses = new WhatsAppStatusHandlerMap();
  const logger = makeLogger();
  return { dispatcher: new WhatsAppDispatcher(messages, interactives, statuses, logger), messages, interactives, statuses, logger };
};

const webhook = (value: Record<string, unknown>): WhatsAppWebhookBody => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PN1', display_phone_number: '15550000000' }, ...value } as never }] }],
});

describe('interactiveReplyId', () => {
  it('reads a button_reply id', () => {
    expect(interactiveReplyId({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'confirm' } } } as WhatsAppMessage)).toBe('confirm');
  });
  it('reads a list_reply id', () => {
    expect(interactiveReplyId({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'pick_1' } } } as WhatsAppMessage)).toBe('pick_1');
  });
  it('reads a quick-reply button payload', () => {
    expect(interactiveReplyId({ type: 'button', button: { payload: 'yes' } } as WhatsAppMessage)).toBe('yes');
  });
  it('returns undefined for a plain text message', () => {
    expect(interactiveReplyId({ type: 'text', text: { body: 'hi' } } as WhatsAppMessage)).toBeUndefined();
  });
});

describe('WhatsAppDispatcher.dispatchWebhook', () => {
  it('routes a text message by type and builds context with the matched contact', async () => {
    const { dispatcher, messages } = makeDispatcher();
    const handler = { handle: vi.fn() };
    messages.set('text', handler);

    await dispatcher.dispatchWebhook(
      webhook({
        contacts: [{ wa_id: '15551112222', profile: { name: 'Ada' } }],
        messages: [{ from: '15551112222', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'hello' } }],
      }),
    );

    expect(handler.handle).toHaveBeenCalledOnce();
    const [message, ctx] = handler.handle.mock.calls[0]!;
    expect(message.text.body).toBe('hello');
    expect(ctx).toMatchObject({ phoneNumberId: 'PN1', displayPhoneNumber: '15550000000', wabaId: 'WABA1' });
    expect(ctx.contact).toEqual({ wa_id: '15551112222', profile: { name: 'Ada' } });
  });

  it('routes an interactive reply by id before falling back to the type map', async () => {
    const { dispatcher, messages, interactives } = makeDispatcher();
    const interactiveHandler = { handle: vi.fn() };
    const typeHandler = { handle: vi.fn() };
    interactives.set('confirm_order', interactiveHandler);
    messages.set('interactive', typeHandler);

    await dispatcher.dispatchWebhook(
      webhook({
        messages: [{ from: 'u', id: 'wamid.2', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'confirm_order' } } }],
      }),
    );

    expect(interactiveHandler.handle).toHaveBeenCalledOnce();
    expect(typeHandler.handle).not.toHaveBeenCalled();
  });

  it('falls back to the type map when no interactive handler matches the id', async () => {
    const { dispatcher, messages } = makeDispatcher();
    const typeHandler = { handle: vi.fn() };
    messages.set('interactive', typeHandler);

    await dispatcher.dispatchWebhook(
      webhook({
        messages: [{ from: 'u', id: 'wamid.3', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'unregistered' } } }],
      }),
    );

    expect(typeHandler.handle).toHaveBeenCalledOnce();
  });

  it('routes statuses by status value', async () => {
    const { dispatcher, statuses } = makeDispatcher();
    const handler = { handle: vi.fn() };
    statuses.set('delivered', handler);

    await dispatcher.dispatchWebhook(webhook({ statuses: [{ id: 'wamid.4', status: 'delivered', timestamp: '1', recipient_id: 'u' }] }));

    expect(handler.handle).toHaveBeenCalledOnce();
    const [status, ctx] = handler.handle.mock.calls[0]!;
    expect(status.status).toBe('delivered');
    expect(ctx.phoneNumberId).toBe('PN1');
  });

  it('logs and skips when no handler is registered', async () => {
    const { dispatcher, logger } = makeDispatcher();
    await dispatcher.dispatchWebhook(webhook({ messages: [{ from: 'u', id: 'wamid.5', timestamp: '1', type: 'image' }] }));
    expect(logger.debug).toHaveBeenCalled();
  });

  it('handles an empty / status-only body without throwing', async () => {
    const { dispatcher } = makeDispatcher();
    await expect(dispatcher.dispatchWebhook({ object: 'whatsapp_business_account' })).resolves.toBeUndefined();
  });

  it('dispatches across multiple entries and messages in one batch', async () => {
    const { dispatcher, messages } = makeDispatcher();
    const handler = { handle: vi.fn() };
    messages.set('text', handler);

    await dispatcher.dispatchWebhook({
      object: 'whatsapp_business_account',
      entry: [
        { id: 'W1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PN1' }, messages: [{ from: 'a', id: 'm1', timestamp: '1', type: 'text', text: { body: 'one' } }] } as never }] },
        { id: 'W2', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PN2' }, messages: [{ from: 'b', id: 'm2', timestamp: '1', type: 'text', text: { body: 'two' } }] } as never }] },
      ],
    });

    expect(handler.handle).toHaveBeenCalledTimes(2);
  });

  it('invokes a message handler once when the same webhook is redelivered with idempotency', async () => {
    const { dispatcher, messages } = makeDispatcher();
    const handler = { handle: vi.fn() };
    messages.set('text', handler);
    const idempotency = makeIdempotencyStore();

    const body = webhook({
      messages: [{ from: '15551112222', id: 'wamid.dup', timestamp: '1', type: 'text', text: { body: 'hello' } }],
    });

    await dispatcher.dispatchWebhook(body, { idempotency });
    await dispatcher.dispatchWebhook(body, { idempotency });

    expect(handler.handle).toHaveBeenCalledOnce();
  });

  it('processes each delivery status of one message separately (same id, different status)', async () => {
    const { dispatcher, statuses } = makeDispatcher();
    const sent = { handle: vi.fn() };
    const delivered = { handle: vi.fn() };
    const read = { handle: vi.fn() };
    statuses.set('sent', sent);
    statuses.set('delivered', delivered);
    statuses.set('read', read);
    const idempotency = makeIdempotencyStore();

    for (const status of ['sent', 'delivered', 'read']) {
      await dispatcher.dispatchWebhook(webhook({ statuses: [{ id: 'wamid.same', status, timestamp: '1', recipient_id: 'u' }] }), { idempotency });
    }
    // Redeliver the whole sequence — every transition already processed, so no extra calls.
    for (const status of ['sent', 'delivered', 'read']) {
      await dispatcher.dispatchWebhook(webhook({ statuses: [{ id: 'wamid.same', status, timestamp: '1', recipient_id: 'u' }] }), { idempotency });
    }

    expect(sent.handle).toHaveBeenCalledOnce();
    expect(delivered.handle).toHaveBeenCalledOnce();
    expect(read.handle).toHaveBeenCalledOnce();
  });

  it('processes every redelivery when no idempotency store is supplied (behaviour unchanged)', async () => {
    const { dispatcher, messages } = makeDispatcher();
    const handler = { handle: vi.fn() };
    messages.set('text', handler);

    const body = webhook({
      messages: [{ from: '15551112222', id: 'wamid.dup', timestamp: '1', type: 'text', text: { body: 'hello' } }],
    });

    await dispatcher.dispatchWebhook(body);
    await dispatcher.dispatchWebhook(body);

    expect(handler.handle).toHaveBeenCalledTimes(2);
  });
});

describe('idempotency key helpers', () => {
  it('keys a message by its wamid', () => {
    expect(whatsappMessageIdempotencyKey({ id: 'wamid.ABC' } as WhatsAppMessage)).toBe('whatsapp:message:wamid.ABC');
  });

  it('keys a status by id AND status value so sent/delivered/read do not collide', () => {
    const base = { id: 'wamid.XYZ' } as WhatsAppStatus;
    expect(whatsappStatusIdempotencyKey({ ...base, status: 'sent' })).toBe('whatsapp:status:wamid.XYZ:sent');
    expect(whatsappStatusIdempotencyKey({ ...base, status: 'delivered' })).toBe('whatsapp:status:wamid.XYZ:delivered');
    expect(whatsappStatusIdempotencyKey({ ...base, status: 'read' })).toBe('whatsapp:status:wamid.XYZ:read');
  });
});
