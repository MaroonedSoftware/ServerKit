/**
 * Discord interaction `type` values. Every interaction Discord POSTs to the
 * interactions endpoint carries one of these.
 *
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object-interaction-type
 */
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;
export type InteractionType = (typeof InteractionType)[keyof typeof InteractionType];

/**
 * Discord interaction callback `type` values — the `type` field of the JSON the
 * endpoint returns in response to an interaction.
 *
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object-interaction-callback-type
 */
export const InteractionCallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9,
} as const;
export type InteractionCallbackType = (typeof InteractionCallbackType)[keyof typeof InteractionCallbackType];

/**
 * Loose typing for an incoming interaction; consumers narrow per handler.
 * Discord's payloads vary by `type`, but every variant has a `type` plus, on
 * `data`, one of: `name` (commands/autocomplete) or `custom_id`
 * (components/modals).
 *
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
export type DiscordInteraction = {
  /** Interaction type — see {@link InteractionType}. */
  type: InteractionType | number;
  /** Unique ID for this interaction. */
  id: string;
  /** Continuation token, valid for 15 minutes, used for followups. */
  token: string;
  /** ID of the application this interaction is for. */
  application_id: string;
  /** Command / component / modal payload; shape depends on `type`. */
  data?: {
    /** Command name (`APPLICATION_COMMAND` / autocomplete). */
    name?: string;
    /** Developer-defined identifier (`MESSAGE_COMPONENT` / `MODAL_SUBMIT`). */
    custom_id?: string;
    /** Component type for `MESSAGE_COMPONENT` interactions. */
    component_type?: number;
    [key: string]: unknown;
  };
  /** Guild the interaction was sent from, if any. */
  guild_id?: string;
  /** Channel the interaction was sent from, if any. */
  channel_id?: string;
  /** Guild member object (present for guild interactions). */
  member?: { user?: { id: string; username?: string }; [key: string]: unknown };
  /** User object (present for DM interactions). */
  user?: { id: string; username?: string; [key: string]: unknown };
  [key: string]: unknown;
};

/**
 * Response the interactions endpoint returns for an interaction. The caller
 * serializes this verbatim as the HTTP response body.
 *
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object
 */
export type DiscordInteractionResponse = {
  /** Callback type — see {@link InteractionCallbackType}. */
  type: InteractionCallbackType | number;
  /** Optional message / autocomplete / modal payload (depends on callback type). */
  data?: Record<string, unknown>;
};

/**
 * Metadata accompanying every dispatched interaction. Surfaces the commonly
 * needed envelope fields plus the raw interaction for handlers that need fields
 * the typed accessors don't expose. Analogous to Slack's `SlackEventContext`.
 */
export type DiscordInteractionContext = {
  /** Application (client) ID from the interaction. */
  applicationId: string;
  /** Unique interaction ID. */
  interactionId: string;
  /** Continuation token for followups (valid 15 minutes). */
  token: string;
  /** Guild ID, if the interaction came from a guild. */
  guildId?: string;
  /** Channel ID, if present. */
  channelId?: string;
  /** Invoking user, resolved from `member.user` (guild) or `user` (DM). */
  user?: { id: string; username?: string };
  /** Original interaction payload, untouched. */
  interaction: DiscordInteraction;
};

/**
 * Handler for one interaction, keyed in `DiscordInteractionHandlerMap` by
 * `${kind}:${identifier}` — see {@link interactionRouteKey}.
 *
 * Handlers should respond quickly — Discord expects an interaction callback
 * within ~3 seconds. For slow work, return a `DEFERRED_*` callback and follow up
 * via `DiscordClient` using the interaction `token`.
 */
export interface DiscordInteractionHandler {
  handle(interaction: DiscordInteraction, context: DiscordInteractionContext): Promise<DiscordInteractionResponse | void>;
}

/**
 * Computes the routing key used by `DiscordDispatcher.dispatchInteraction` to
 * look a handler up in `DiscordInteractionHandlerMap`.
 *
 * - `APPLICATION_COMMAND` (2) → `command:<data.name>`
 * - `MESSAGE_COMPONENT` (3) → `component:<data.custom_id>`
 * - `APPLICATION_COMMAND_AUTOCOMPLETE` (4) → `autocomplete:<data.name>`
 * - `MODAL_SUBMIT` (5) → `modal:<data.custom_id>`
 *
 * `PING` (1) is handled directly by the dispatcher and never routed.
 *
 * @returns The routing key, or `undefined` if the payload doesn't carry an
 *   identifier we can route on (or is a type we don't route, like `PING`).
 */
export const interactionRouteKey = (interaction: DiscordInteraction): string | undefined => {
  switch (interaction.type) {
    case InteractionType.APPLICATION_COMMAND: {
      return interaction.data?.name ? `command:${interaction.data.name}` : undefined;
    }
    case InteractionType.MESSAGE_COMPONENT: {
      return interaction.data?.custom_id ? `component:${interaction.data.custom_id}` : undefined;
    }
    case InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE: {
      return interaction.data?.name ? `autocomplete:${interaction.data.name}` : undefined;
    }
    case InteractionType.MODAL_SUBMIT: {
      return interaction.data?.custom_id ? `modal:${interaction.data.custom_id}` : undefined;
    }
    default: {
      return undefined;
    }
  }
};
