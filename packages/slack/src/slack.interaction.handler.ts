/**
 * The supported interactive payload types Slack POSTs to the interactivity
 * endpoint. Each maps to a different identifier shape (see
 * {@link interactionRouteKey}).
 */
export type SlackInteractionType = 'block_actions' | 'view_submission' | 'view_closed' | 'shortcut' | 'message_action' | string;

/**
 * Loose typing for the interactive payload; consumers narrow per handler.
 * Slack's payloads vary by type, but every variant has a `type` field plus
 * one of: `actions[].action_id`, `view.callback_id`, or top-level `callback_id`.
 */
export type SlackInteractionPayload = {
  type: SlackInteractionType;
  team?: { id: string; domain?: string };
  user?: { id: string; name?: string };
  trigger_id?: string;
  response_url?: string;
  actions?: Array<{ action_id: string; block_id?: string; value?: string; [key: string]: unknown }>;
  view?: { id: string; callback_id: string; [key: string]: unknown };
  callback_id?: string;
  [key: string]: unknown;
};

/**
 * Optional response Slack accepts for `view_submission` / `view_closed`
 * payloads (e.g. to display validation errors or update a modal).
 */
export type SlackInteractionResponse = {
  response_action?: 'errors' | 'update' | 'push' | 'clear';
  errors?: Record<string, string>;
  view?: unknown;
  [key: string]: unknown;
};

/**
 * Handler for one interactive payload, keyed in {@link SlackInteractionHandlerMap}
 * by `${type}:${identifier}` — see {@link interactionRouteKey}.
 */
export interface SlackInteractionHandler {
  handle(payload: SlackInteractionPayload): Promise<SlackInteractionResponse | void>;
}

/**
 * Computes the routing key used by {@link SlackDispatcher.dispatchInteraction}
 * to look a handler up in {@link SlackInteractionHandlerMap}.
 *
 * - `block_actions` → `block_actions:<first action.action_id>`
 * - `view_submission` / `view_closed` → `<type>:<view.callback_id>`
 * - `shortcut` / `message_action` → `<type>:<callback_id>`
 * - any other type with a `callback_id` → `<type>:<callback_id>`
 *
 * @returns The routing key, or `undefined` if the payload doesn't carry an
 *   identifier we can route on (e.g. a `block_actions` payload with no actions).
 */
export const interactionRouteKey = (payload: SlackInteractionPayload): string | undefined => {
  switch (payload.type) {
    case 'block_actions': {
      const id = payload.actions?.[0]?.action_id;
      return id ? `block_actions:${id}` : undefined;
    }
    case 'view_submission':
    case 'view_closed': {
      const id = payload.view?.callback_id;
      return id ? `${payload.type}:${id}` : undefined;
    }
    case 'shortcut':
    case 'message_action': {
      return payload.callback_id ? `${payload.type}:${payload.callback_id}` : undefined;
    }
    default: {
      return payload.callback_id ? `${payload.type}:${payload.callback_id}` : undefined;
    }
  }
};
