import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { IdempotencyStore } from '@maroonedsoftware/cache';
import {
  InteractionCallbackType,
  InteractionType,
  interactionRouteKey,
  discordInteractionIdempotencyKey,
  DiscordInteractionHandler,
  type DiscordInteraction,
  type DiscordInteractionContext,
  type DiscordInteractionResponse,
} from './discord.interaction.handler.js';

/** Optional per-dispatch behaviour for {@link DiscordDispatcher.dispatchInteraction}. */
export interface DiscordDispatchOptions {
  /**
   * When provided, the handler invocation (never the `PING` handshake) is wrapped in
   * {@link IdempotencyStore.deduplicate} keyed by {@link discordInteractionIdempotencyKey},
   * so a duplicate delivery of the same `interaction.id` runs the handler at most once.
   *
   * Discord does NOT redeliver HTTP interactions the way Slack/WhatsApp/Telegram redeliver
   * events, so this is a conservative guard against duplicate *side effects* from an
   * out-of-band resend (a proxy/gateway retry or a client double-submit), not a redelivery
   * net. A first delivery is `processed` and its response body is returned unchanged; only a
   * genuine `duplicate`/`dropped` skips the handler and returns `undefined` (the caller acks).
   * Omit it to keep the default behaviour.
   */
  idempotency?: IdempotencyStore;
}

/**
 * Injectable map of interaction routing keys → {@link DiscordInteractionHandler}.
 *
 * Keys are produced by `interactionRouteKey(interaction)`, which combines the
 * interaction kind with the relevant identifier (`command:<name>`,
 * `component:<custom_id>`, `autocomplete:<name>`, `modal:<custom_id>`). Register
 * handlers under the same key shape:
 *
 * @example
 * ```ts
 * const interactions = new DiscordInteractionHandlerMap();
 * interactions.set('command:deploy', container.get(DeployCommandHandler));
 * interactions.set('component:approve_button', container.get(ApproveHandler));
 * interactions.set('modal:create_ticket', container.get(CreateTicketHandler));
 * container.register(DiscordInteractionHandlerMap, { useValue: interactions });
 * ```
 */
@Injectable()
export class DiscordInteractionHandlerMap extends Map<string, DiscordInteractionHandler> {}

/**
 * Single entry point for dispatching parsed Discord interactions to registered
 * handlers. Transport-agnostic: the consumer is responsible for receiving the
 * HTTP request, verifying the signature, parsing the body, calling
 * {@link DiscordDispatcher.dispatchInteraction}, and serializing the response.
 *
 * Unlike Slack (where a `void` handler result is acked with an empty 200),
 * Discord requires a JSON interaction callback. The caller serializes the
 * returned {@link DiscordInteractionResponse} as the HTTP body; a handler should
 * return a response (or a `DEFERRED_*` callback and follow up via the REST
 * client). When no handler matches, the dispatcher returns `undefined` and the
 * caller decides the fallback (e.g. a 404 or a generic ephemeral message).
 *
 * @example Koa route
 * ```ts
 * router.post('/discord/interactions', async (ctx) => {
 *   const raw = await rawBody(ctx.req, { encoding: 'utf8' });
 *   verifyDiscordSignature({
 *     publicKey: ctx.container.get(DiscordConfig).publicKey,
 *     rawBody: raw,
 *     timestamp: ctx.get('x-signature-timestamp'),
 *     signature: ctx.get('x-signature-ed25519'),
 *   });
 *   const result = await ctx.container.get(DiscordDispatcher).dispatchInteraction(JSON.parse(raw));
 *   if (result) ctx.body = result;
 *   else ctx.status = 404;
 * });
 * ```
 */
@Injectable()
export class DiscordDispatcher {
  constructor(
    private readonly interactions: DiscordInteractionHandlerMap,
    private readonly logger: Logger,
  ) {}

  /**
   * Dispatch a parsed interaction.
   *
   * - `PING` (type 1) → returns `{ type: PONG }` for the endpoint handshake. This
   *   is answered directly and is NEVER de-duplicated (it must always PONG).
   * - Otherwise computes a routing key via {@link interactionRouteKey} and looks
   *   it up in {@link DiscordInteractionHandlerMap}. Missing key or no handler →
   *   logs at debug and returns `undefined`.
   *
   * Pass `options.idempotency` to guard the handler invocation against a duplicate
   * delivery of the same `interaction.id` (keyed by {@link discordInteractionIdempotencyKey}).
   * A first delivery is `processed` and its response body is returned unchanged; a
   * `duplicate`/`dropped` outcome skips the handler and returns `undefined`. Because Discord
   * does not redeliver interactions, this is a conservative side-effect guard, not a
   * redelivery net — see {@link DiscordDispatchOptions.idempotency}. Without it, behaviour
   * is unchanged.
   */
  async dispatchInteraction(interaction: DiscordInteraction, options?: DiscordDispatchOptions): Promise<DiscordInteractionResponse | undefined> {
    if (interaction.type === InteractionType.PING) {
      return { type: InteractionCallbackType.PONG };
    }

    const key = interactionRouteKey(interaction);
    if (!key) {
      this.logger.debug('Discord interaction missing routable identifier', { type: interaction.type });
      return undefined;
    }

    const handler = this.interactions.get(key);
    if (!handler) {
      this.logger.debug('No Discord interaction handler registered', { key });
      return undefined;
    }

    const context: DiscordInteractionContext = {
      applicationId: interaction.application_id,
      interactionId: interaction.id,
      token: interaction.token,
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      user: interaction.member?.user ?? interaction.user,
      interaction,
    };

    if (options?.idempotency) {
      const idempotencyKey = discordInteractionIdempotencyKey(interaction);
      const outcome = await options.idempotency.deduplicate(idempotencyKey, () => handler.handle(interaction, context));
      if (outcome.status === 'processed') {
        return outcome.result ?? undefined;
      }
      if (outcome.status === 'dropped') {
        this.logger.warn('Discord interaction dead-lettered after repeated failures', { key: idempotencyKey, attempts: outcome.attempts });
      }
      // duplicate or dropped: skip the handler; the caller acks (200 with no body).
      return undefined;
    }

    return (await handler.handle(interaction, context)) ?? undefined;
  }
}
