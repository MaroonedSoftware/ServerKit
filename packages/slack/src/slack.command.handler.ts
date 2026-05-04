/**
 * Decoded slash-command payload Slack delivers as `application/x-www-form-urlencoded`.
 * Field documentation: https://api.slack.com/interactivity/slash-commands#app_command_handling.
 */
export type SlackCommandPayload = {
  /** Verification token (deprecated by Slack — prefer signature verification). */
  token: string;
  team_id: string;
  team_domain: string;
  enterprise_id?: string;
  enterprise_name?: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  /** The command keyword, including the leading slash (e.g. `/deploy`). */
  command: string;
  /** Everything the user typed after the command. */
  text: string;
  /** URL the handler can POST to within 30 minutes for follow-up responses. */
  response_url: string;
  /** Short-lived token usable with `views.open`. */
  trigger_id: string;
  api_app_id?: string;
};

/**
 * Response body for a slash command. Slack accepts plain text or a Block Kit
 * payload; the optional `response_type` controls visibility.
 */
export type SlackCommandResponse = {
  /** Plain text shown to the user when no `blocks` are provided. */
  text?: string;
  /** Block Kit blocks. */
  blocks?: unknown[];
  /** `'ephemeral'` (only the invoker sees it, default) or `'in_channel'`. */
  response_type?: 'ephemeral' | 'in_channel';
  [key: string]: unknown;
};

/**
 * Handler for one slash command keyed by its full command string (with slash,
 * e.g. `/deploy`). Registered in {@link SlackCommandHandlerMap}.
 *
 * Returning a {@link SlackCommandResponse} makes Slack render it immediately;
 * returning `void` acks with an empty 200 (the handler is responsible for any
 * follow-up via `response_url`).
 */
export interface SlackCommandHandler {
  handle(payload: SlackCommandPayload): Promise<SlackCommandResponse | void>;
}
