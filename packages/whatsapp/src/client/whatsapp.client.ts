import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { WhatsAppConfig, WHATSAPP_DEFAULT_GRAPH_API_VERSION } from '../whatsapp.config.js';
import { WhatsAppError } from '../whatsapp.error.js';

/** Base host for the Meta Graph API. */
export const WHATSAPP_GRAPH_API_HOST = 'https://graph.facebook.com';

/** HTTP methods used by {@link WhatsAppClient.request}. */
type WhatsAppHttpMethod = 'GET' | 'POST' | 'DELETE';

/**
 * Thin DI-friendly wrapper around the WhatsApp Cloud API built on `fetch` (no
 * SDK). Constructed once per request scope (or as a singleton, depending on how
 * the consumer registers it) and exposes typed helpers for the most common
 * messaging calls, plus a generic {@link request} escape hatch.
 *
 * @example
 * ```ts
 * await container.get(WhatsAppClient).sendText('15551234567', 'hello');
 * await container.get(WhatsAppClient).markAsRead('wamid.abc');
 * ```
 */
@Injectable()
export class WhatsAppClient {
  private readonly version: string;

  constructor(
    private readonly config: WhatsAppConfig,
    private readonly logger: Logger,
  ) {
    this.version = config.graphApiVersion ?? WHATSAPP_DEFAULT_GRAPH_API_VERSION;
  }

  /** Sends a message via `POST /{phoneNumberId}/messages`. The body is forwarded verbatim. */
  sendMessage(body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/${this.config.phoneNumberId}/messages`, body);
  }

  /** Convenience helper for a plain text message. */
  sendText(to: string, body: string, options: { previewUrl?: boolean } = {}): Promise<unknown> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: options.previewUrl ?? false, body },
    });
  }

  /** Convenience helper for an interactive message (buttons / list). */
  sendInteractive(to: string, interactive: Record<string, unknown>): Promise<unknown> {
    return this.sendMessage({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'interactive', interactive });
  }

  /** Marks an inbound message as read via the messages endpoint. */
  markAsRead(messageId: string): Promise<unknown> {
    return this.sendMessage({ messaging_product: 'whatsapp', status: 'read', message_id: messageId });
  }

  /**
   * Low-level request helper. Prefixes the Graph API host + version, sets JSON
   * headers, adds the `Authorization: Bearer <accessToken>` header, and throws
   * {@link WhatsAppError} on a non-2xx response.
   *
   * Returns the parsed JSON body, or `undefined` for empty responses.
   */
  async request(method: WhatsAppHttpMethod, path: string, body?: unknown): Promise<unknown> {
    const url = `${WHATSAPP_GRAPH_API_HOST}/${this.version}${path}`;
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.accessToken}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.warn('WhatsApp Graph API call returned non-OK status', { status: response.status, method, path });
      throw new WhatsAppError(`WhatsApp Graph API call ${method} ${path} returned ${response.status}`).withInternalDetails({
        status: response.status,
        body: text,
        url,
      });
    }

    const text = await response.text().catch(() => '');
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
