/**
 * Metadata accompanying every dispatched Slack event. Includes the wrapping
 * envelope fields (team/event IDs) plus the raw `event_callback` payload for
 * handlers that need fields the typed `event` object doesn't expose.
 */
export type SlackEventContext = {
  /** Slack workspace / team ID from the envelope. */
  teamId: string;
  /** Unique event ID Slack assigns to each delivery. */
  eventId: string;
  /** Unix timestamp the event was generated. */
  eventTime: number;
  /** Original `event_callback` envelope, untouched. */
  envelope: SlackEventCallback;
};

/**
 * Slack `event_callback` envelope. The shape is documented at
 * https://api.slack.com/types/event. We type the wrapper but leave the inner
 * `event` as `Record<string, unknown>` because the union of all Slack event
 * payloads is large and consumers typically narrow per handler.
 */
export type SlackEventCallback = {
  type: 'event_callback';
  team_id: string;
  api_app_id: string;
  event: { type: string } & Record<string, unknown>;
  event_id: string;
  event_time: number;
  authorizations?: unknown[];
  is_ext_shared_channel?: boolean;
  event_context?: string;
  [key: string]: unknown;
};

/**
 * Handler for a single Slack event type (e.g. `app_mention`, `message`,
 * `reaction_added`). Registered in {@link SlackEventHandlerMap}.
 *
 * Handlers should ack quickly — Slack retries any event that doesn't get a
 * 2xx response within ~3 seconds. For slow work, enqueue a job
 * (`@maroonedsoftware/jobbroker`) inside `handle` and return immediately.
 */
export interface SlackEventHandler<TEvent extends { type: string } & Record<string, unknown> = { type: string } & Record<string, unknown>> {
  handle(event: TEvent, context: SlackEventContext): Promise<void>;
}
