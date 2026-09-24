import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { DiscordConfig } from '../discord.config.js';
import { DiscordError } from '../discord.error.js';
import { InteractionCallbackType, type DiscordInteraction } from '../discord.interaction.handler.js';

/** Base URL for the Discord REST API (v10). */
export const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** Default per-request timeout (ms) applied to outbound REST calls. */
export const DISCORD_DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Masks the interaction-token segment of the token-bearing REST paths so a path
 * is safe to log. The token is a live 15-minute credential, so it is replaced
 * with `***` in both `/webhooks/{applicationId}/{token}…` (followups, edits) and
 * `/interactions/{id}/{token}/callback` (initial response) routes. Other paths
 * are returned unchanged.
 */
export const redactDiscordWebhookToken = (path: string): string =>
  path.replace(/^(\/webhooks\/[^/]+\/)[^/]+/, '$1***').replace(/^(\/interactions\/[^/]+\/)[^/]+/, '$1***');

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
  /** Overrides `DiscordConfig.requestTimeoutMs` for this one call. */
  timeoutMs?: number;
};

/** What `GET /gateway/bot` answers: where to connect, and how many sessions are left. */
export type DiscordGatewayBot = {
  /** The Gateway WebSocket URL, without the version and encoding query. */
  url: string;
  /** Recommended shard count. */
  shards: number;
  /** Identify budget: `total`, `remaining`, `reset_after` (ms) and `max_concurrency`. */
  session_start_limit: { total: number; remaining: number; reset_after: number; max_concurrency: number };
};

/** Query for {@link DiscordClient.getChannelMessages}. */
export type DiscordChannelMessagesQuery = {
  /** Only messages after this message id. */
  after?: string;
  /** Page size, 1–100 (Discord's default is 50). */
  limit?: number;
};

/**
 * Thin DI-friendly wrapper around the Discord REST API built on `fetch` (no
 * SDK). Constructed once per request scope (or as a singleton, depending on how
 * the consumer registers it) and exposes typed helpers for the most common
 * interaction-followup and messaging calls, plus a generic {@link request}
 * escape hatch for anything else.
 *
 * Every call goes through `DiscordConfig.fetch` when it is set. A call that
 * never reached Discord throws {@link DiscordError} with the bot token and any
 * interaction token redacted from everything it carries.
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
   * Sends the initial interaction response via
   * `POST /interactions/{id}/{token}/callback` (no bot auth — the token
   * authorizes). Acknowledges the interaction so subsequent
   * {@link createFollowupMessage} calls are valid.
   */
  createInteractionResponse(interactionId: string, token: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/interactions/${interactionId}/${token}/callback`, { body, auth: false });
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
   * Acknowledges an interaction now and answers it later, via
   * {@link createInteractionResponse}. `'message'` sends callback type 5 (a
   * "thinking…" placeholder, edited later with
   * {@link editOriginalInteractionResponse}); `'update'` sends type 6 (for a
   * component, the message is edited later in place).
   */
  deferInteraction(interaction: Pick<DiscordInteraction, 'id' | 'token'>, kind: 'message' | 'update' = 'message'): Promise<unknown> {
    const type = kind === 'update' ? InteractionCallbackType.DEFERRED_UPDATE_MESSAGE : InteractionCallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE;
    return this.createInteractionResponse(interaction.id, interaction.token, { type });
  }

  /** Where the Gateway is and how many identifies are left, via `GET /gateway/bot` (bot auth). */
  async getGatewayBot(): Promise<DiscordGatewayBot> {
    return (await this.request('GET', '/gateway/bot')) as DiscordGatewayBot;
  }

  /** The bot's own user, via `GET /users/@me` (bot auth). The cheapest call that proves the token works. */
  getCurrentUser(): Promise<unknown> {
    return this.request('GET', '/users/@me');
  }

  /**
   * A page of a channel's messages via `GET /channels/{id}/messages` (bot
   * auth), newest first. Pass `after` to read only what came after a known
   * message.
   */
  async getChannelMessages(channelId: string, query: DiscordChannelMessagesQuery = {}): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (query.after !== undefined) params.set('after', query.after);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const search = params.size > 0 ? `?${params.toString()}` : '';
    const result = await this.request('GET', `/channels/${channelId}/messages${search}`);
    return Array.isArray(result) ? result : [];
  }

  /**
   * Low-level request helper. Prefixes `config.apiBaseUrl` (default
   * {@link DISCORD_API_BASE}), sets JSON headers, adds the bot `Authorization`
   * header unless `auth: false`, and throws {@link DiscordError} on a non-2xx
   * response or a transport failure.
   *
   * On a 429, `internalDetails.retryAfter` carries Discord's wait in seconds,
   * from the body's `retry_after` or else the `Retry-After` header.
   *
   * Returns the parsed JSON body, or `undefined` for empty (e.g. `204`) responses.
   */
  async request(method: DiscordHttpMethod, path: string, options: DiscordRequestOptions = {}): Promise<unknown> {
    const { body, auth = true, timeoutMs } = options;
    const base = this.config.apiBaseUrl ?? DISCORD_API_BASE;
    const url = `${base}${path}`;
    // The interaction token lives in `/webhooks/{app}/{token}` and
    // `/interactions/{id}/{token}` paths — redact it before it reaches the log
    // or the loggable internalDetails.
    const safePath = redactDiscordWebhookToken(path);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth) {
      headers.authorization = `Bot ${this.config.botToken}`;
    }
    const fetcher = this.config.fetch ?? fetch;

    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? this.config.requestTimeoutMs ?? DISCORD_DEFAULT_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Deliberately not `withCause(error)`: the cause's message can quote the
      // URL, and the URL can hold an interaction token.
      const reason = this.redact(error instanceof Error ? error.message : String(error), path, safePath);
      this.logger.warn('Discord REST call did not reach Discord', { method, path: safePath, reason });
      throw new DiscordError(`Discord REST call ${method} ${safePath} did not reach Discord`).withInternalDetails({ method, path: safePath, reason });
    }

    if (!response.ok) {
      const text = this.redact(await response.text().catch(() => ''), path, safePath);
      const retryAfter = response.status === 429 ? this.retryAfter(text, response.headers.get('retry-after')) : undefined;
      this.logger.warn('Discord REST call returned non-OK status', { status: response.status, method, path: safePath, retryAfter });
      throw new DiscordError(`Discord REST call ${method} ${safePath} returned ${response.status}`).withInternalDetails({
        status: response.status,
        body: text,
        url: `${base}${safePath}`,
        ...(retryAfter !== undefined ? { retryAfter } : {}),
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

  /** Discord's wait in seconds: the JSON body's `retry_after`, else the `Retry-After` header. */
  private retryAfter(body: string, header: string | null): number | undefined {
    try {
      const parsed = JSON.parse(body) as { retry_after?: unknown };
      if (typeof parsed.retry_after === 'number') return parsed.retry_after;
    } catch {
      // Not JSON; fall through to the header.
    }
    const seconds = header === null ? NaN : Number(header);
    return Number.isFinite(seconds) ? seconds : undefined;
  }

  /** `text` with the bot token and the raw (token-bearing) path replaced wherever they appear. */
  private redact(text: string, path: string, safePath: string): string {
    const token = this.config.botToken;
    const withoutPath = path === safePath ? text : text.split(path).join(safePath);
    return token ? withoutPath.split(token).join('<token>') : withoutPath;
  }
}
