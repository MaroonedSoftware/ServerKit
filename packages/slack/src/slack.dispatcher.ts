import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { SlackEventCallback, SlackEventHandler } from './slack.event.handler.js';
import type { SlackCommandHandler, SlackCommandPayload, SlackCommandResponse } from './slack.command.handler.js';
import {
  interactionRouteKey,
  SlackInteractionHandler,
  type SlackInteractionPayload,
  type SlackInteractionResponse,
} from './slack.interaction.handler.js';

/**
 * Body shape Slack POSTs to the Events API endpoint. The handshake variant
 * (`url_verification`) is sent once during app configuration; the rest of the
 * traffic is `event_callback` envelopes (or other future top-level types).
 */
export type SlackEventsRequest =
  | { type: 'url_verification'; challenge: string; token?: string }
  | SlackEventCallback
  | { type: string; [key: string]: unknown };

/**
 * Response Slack expects for the `url_verification` handshake. For
 * `event_callback` and unknown event types, the dispatcher returns
 * `undefined` and the caller should ack with HTTP 200.
 */
export type SlackEventsResponse = { challenge: string } | undefined;

/**
 * Injectable map of command keyword (e.g. `/deploy`) → {@link SlackCommandHandler}.
 *
 * @example
 * ```ts
 * const commands = new SlackCommandHandlerMap();
 * commands.set('/deploy', container.get(DeployCommandHandler));
 * container.register(SlackCommandHandlerMap, { useValue: commands });
 * ```
 */
@Injectable()
export class SlackCommandHandlerMap extends Map<string, SlackCommandHandler> {}

/**
 * Injectable map of Slack event type → {@link SlackEventHandler}. Consumers
 * register handlers at bootstrap and place an instance of this map in their
 * DI container; {@link SlackDispatcher.dispatchEvent} resolves it per request.
 *
 * @example
 * ```ts
 * const handlers = new SlackEventHandlerMap();
 * handlers.set('app_mention', container.get(MyAppMentionHandler));
 * container.register(SlackEventHandlerMap, { useValue: handlers });
 * ```
 */
@Injectable()
export class SlackEventHandlerMap extends Map<string, SlackEventHandler> {}

/**
 * Injectable map of interaction routing keys → {@link SlackInteractionHandler}.
 *
 * Keys are produced by `interactionRouteKey(payload)`, which combines the
 * payload `type` with the relevant identifier (`action_id`, `callback_id`,
 * etc.). Register handlers under the same key shape:
 *
 * @example
 * ```ts
 * const interactions = new SlackInteractionHandlerMap();
 * interactions.set('block_actions:approve_button', container.get(ApproveHandler));
 * interactions.set('view_submission:create_ticket_modal', container.get(CreateTicketHandler));
 * container.register(SlackInteractionHandlerMap, { useValue: interactions });
 * ```
 */
@Injectable()
export class SlackInteractionHandlerMap extends Map<string, SlackInteractionHandler> {}

/**
 * Single entry point for dispatching parsed Slack payloads to registered
 * handlers. Transport-agnostic: the consumer is responsible for receiving
 * the HTTP request, verifying the signature, parsing the body, calling the
 * appropriate `dispatch*` method, and serializing the response.
 *
 * @example Koa route
 * ```ts
 * router.post('/slack/events', async (ctx) => {
 *   const raw = await rawBody(ctx.req, { encoding: 'utf8' });
 *   verifySlackSignature({
 *     signingSecret: ctx.container.get(SlackConfig).signingSecret,
 *     rawBody: raw,
 *     timestamp: ctx.get('x-slack-request-timestamp'),
 *     signature: ctx.get('x-slack-signature'),
 *   });
 *   const result = await ctx.container.get(SlackDispatcher).dispatchEvent(JSON.parse(raw));
 *   if (result) ctx.body = result;
 *   else { ctx.status = 200; ctx.body = ''; }
 * });
 * ```
 */
@Injectable()
export class SlackDispatcher {
  constructor(
    private readonly events: SlackEventHandlerMap,
    private readonly commands: SlackCommandHandlerMap,
    private readonly interactions: SlackInteractionHandlerMap,
    private readonly logger: Logger,
  ) {}

  /**
   * Dispatch a parsed Events API body.
   *
   * - Returns `{ challenge }` for `url_verification` — the caller serializes
   *   it as the response body.
   * - For `event_callback`, looks up a handler in {@link SlackEventHandlerMap}
   *   keyed by `event.type` and invokes it. Returns `undefined`. Slack retries
   *   any non-2xx so unknown event types are logged at debug and acked.
   * - For any other top-level type, logs and returns `undefined`.
   */
  async dispatchEvent(body: SlackEventsRequest): Promise<SlackEventsResponse> {
    if (body.type === 'url_verification') {
      return { challenge: (body as { challenge: string }).challenge };
    }

    if (body.type === 'event_callback') {
      const envelope = body as SlackEventCallback;
      const handler = this.events.get(envelope.event.type);
      if (handler) {
        await handler.handle(envelope.event, {
          teamId: envelope.team_id,
          eventId: envelope.event_id,
          eventTime: envelope.event_time,
          envelope,
        });
      } else {
        this.logger.debug('No Slack event handler registered for event type', { type: envelope.event.type });
      }
      return undefined;
    }

    this.logger.debug('Unhandled Slack events payload type', { type: body.type });
    return undefined;
  }

  /**
   * Dispatch a parsed slash-command payload.
   *
   * Looks up a handler in {@link SlackCommandHandlerMap} keyed by
   * `payload.command` (e.g. `/deploy`). If the handler returns a response,
   * the caller serializes it as JSON; otherwise the caller acks with `200 ''`
   * and the handler is expected to follow up via `payload.response_url`.
   */
  async dispatchCommand(payload: SlackCommandPayload): Promise<SlackCommandResponse | void> {
    const handler = this.commands.get(payload.command);
    if (!handler) {
      this.logger.debug('No Slack command handler registered', { command: payload.command });
      return undefined;
    }
    return await handler.handle(payload);
  }

  /**
   * Dispatch a parsed interactive payload (block actions, view submission,
   * shortcut, etc.). Computes a routing key via {@link interactionRouteKey}
   * and looks it up in {@link SlackInteractionHandlerMap}.
   */
  async dispatchInteraction(payload: SlackInteractionPayload): Promise<SlackInteractionResponse | void> {
    const key = interactionRouteKey(payload);
    if (!key) {
      this.logger.debug('Slack interaction payload missing routable identifier', { type: payload.type });
      return undefined;
    }
    const handler = this.interactions.get(key);
    if (!handler) {
      this.logger.debug('No Slack interaction handler registered', { key });
      return undefined;
    }
    return await handler.handle(payload);
  }
}
