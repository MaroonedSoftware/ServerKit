import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { DiscordConfig } from '../discord.config.js';
import { DiscordError } from '../discord.error.js';

/** Base URL for the Discord REST API (v10). */
export const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** HTTP methods used by {@link DiscordClient.request}. */
type DiscordHttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Options for the low-level {@link DiscordClient.request} escape hatch. */
export type DiscordRequestOptions = {
  /** JSON-serializable request body. */
  body?: unknown;
  /**
   * Whether to send the bot `Authorization` header. Bot-scoped routes (channels,
   * command registration) need it; interaction followup routes use the
   * interaction token in the path and must **not** be bot-authenticated.
   * Defaults to `true`.
   */
  auth?: boolean;
};

/**
 * Thin DI-friendly wrapper around the Discord REST API built on `fetch` (no
 * SDK). Constructed once per request scope (or as a singleton, depending on how
 * the consumer registers it) and exposes typed helpers for the most common
 * interaction-followup and messaging calls, plus a generic {@link request}
 * escape hatch for anything else.
 *
 * @example
 * ```ts
 * await container.get(DiscordClient).createMessage('123', { content: 'hello' });
 * await container.get(DiscordClient).createFollowupMessage(interaction.token, { content: 'done' });
 * ```
 */
@Injectable()
export class DiscordClient {
  constructor(
    private readonly config: DiscordConfig,
    private readonly logger: Logger,
  ) {}

  /** Posts a message to a channel via `POST /channels/{id}/messages` (bot auth). */
  createMessage(channelId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/channels/${channelId}/messages`, { body });
  }

  /**
   * Sends a followup message for an interaction via
   * `POST /webhooks/{applicationId}/{token}` (no bot auth — the token authorizes).
   */
  createFollowupMessage(token: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/webhooks/${this.config.applicationId}/${token}`, { body, auth: false });
  }

  /**
   * Edits the original interaction response via
   * `PATCH /webhooks/{applicationId}/{token}/messages/@original`.
   */
  editOriginalInteractionResponse(token: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('PATCH', `/webhooks/${this.config.applicationId}/${token}/messages/@original`, { body, auth: false });
  }

  /**
   * Deletes the original interaction response via
   * `DELETE /webhooks/{applicationId}/{token}/messages/@original`.
   */
  deleteOriginalInteractionResponse(token: string): Promise<unknown> {
    return this.request('DELETE', `/webhooks/${this.config.applicationId}/${token}/messages/@original`, { auth: false });
  }

  /**
   * Bulk-overwrites the application's global slash commands via
   * `PUT /applications/{applicationId}/commands` (bot auth).
   */
  bulkOverwriteGlobalCommands(commands: unknown[]): Promise<unknown> {
    return this.request('PUT', `/applications/${this.config.applicationId}/commands`, { body: commands });
  }

  /**
   * Bulk-overwrites the application's commands for one guild via
   * `PUT /applications/{applicationId}/guilds/{guildId}/commands` (bot auth).
   */
  bulkOverwriteGuildCommands(guildId: string, commands: unknown[]): Promise<unknown> {
    return this.request('PUT', `/applications/${this.config.applicationId}/guilds/${guildId}/commands`, { body: commands });
  }

  /**
   * Low-level request helper. Prefixes {@link DISCORD_API_BASE}, sets JSON
   * headers, adds the bot `Authorization` header unless `auth: false`, and
   * throws {@link DiscordError} on a non-2xx response.
   *
   * Returns the parsed JSON body, or `undefined` for empty (e.g. `204`) responses.
   */
  async request(method: DiscordHttpMethod, path: string, options: DiscordRequestOptions = {}): Promise<unknown> {
    const { body, auth = true } = options;
    const url = `${DISCORD_API_BASE}${path}`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth) {
      headers.authorization = `Bot ${this.config.botToken}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.warn('Discord REST call returned non-OK status', { status: response.status, method, path });
      throw new DiscordError(`Discord REST call ${method} ${path} returned ${response.status}`).withInternalDetails({
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
