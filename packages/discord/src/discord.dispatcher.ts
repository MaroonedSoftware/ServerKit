import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import {
  InteractionCallbackType,
  InteractionType,
  interactionRouteKey,
  DiscordInteractionHandler,
  type DiscordInteraction,
  type DiscordInteractionContext,
  type DiscordInteractionResponse,
} from './discord.interaction.handler.js';

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
   * - `PING` (type 1) → returns `{ type: PONG }` for the endpoint handshake.
   * - Otherwise computes a routing key via {@link interactionRouteKey} and looks
   *   it up in {@link DiscordInteractionHandlerMap}. Missing key or no handler →
   *   logs at debug and returns `undefined`.
   */
  async dispatchInteraction(interaction: DiscordInteraction): Promise<DiscordInteractionResponse | undefined> {
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

    return (await handler.handle(interaction, context)) ?? undefined;
  }
}
