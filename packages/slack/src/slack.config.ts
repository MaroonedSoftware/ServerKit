/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { Injectable } from 'injectkit';
import type { FetchFunction } from '@slack/web-api';

/**
 * Configuration for the Slack package. Declared as an abstract `@Injectable()`
 * class so it doubles as a DI token (mirrors the `Logger` pattern in
 * `@maroonedsoftware/logger`).
 *
 * Consumers register a concrete value at bootstrap, typically resolved from
 * `AppConfig`:
 *
 * ```ts
 * const slackConfig = appConfig.getAs<SlackConfig>('slack');
 * registry.register(SlackConfig).useValue(slackConfig);
 * ```
 *
 * Services in this package take `SlackConfig` directly in their constructor.
 */
export interface SlackConfig {
  /** Bot user OAuth token (`xoxb-...`). Required for Web API calls. */
  botToken: string;
  /**
   * App-level signing secret used to verify request signatures. Needed only when Slack calls you
   * over HTTP; a Socket Mode app can leave it unset, and signature verification then fails closed
   * with `missing_signing_secret`.
   */
  signingSecret?: string;
  /**
   * App-level token (`xapp-...`) with the `connections:write` scope. Needed only for Socket Mode,
   * where {@link import('./client/slack.client.js').SlackClient.openSocketModeUrl} trades it for a
   * WebSocket URL.
   */
  appToken?: string;
  /** Optional incoming webhook URL used as the default target for `SlackClient.postWebhook`. */
  incomingWebhookUrl?: string;
  /**
   * Maximum age (in seconds) for request timestamps before signature
   * verification rejects them as replays. Defaults to `300` (5 minutes).
   */
  signatureMaxAgeSeconds?: number;
  /**
   * Per-request timeout (in milliseconds) for outbound `SlackClient.postWebhook`
   * calls. Defaults to
   * {@link import('./client/slack.client.js').SLACK_DEFAULT_REQUEST_TIMEOUT_MS} (10s).
   */
  requestTimeoutMs?: number;
  /**
   * Base URL for Web API calls, forwarded to `@slack/web-api` as `slackApiUrl`. Defaults to the
   * SDK's own (`https://slack.com/api/`).
   */
  apiBaseUrl?: string;
  /**
   * The `fetch` every outbound call goes through: the Web API client, `postWebhook`, and
   * `openSocketModeUrl`. Defaults to the global `fetch`.
   *
   * Set it when the caller owns the transport: a host that routes outbound HTTP through its own
   * allowlist, rate limits or proxy, or a test. The client passes an `AbortSignal` carrying its
   * timeout; an implementation that enforces its own deadline as well may ignore it.
   */
  fetch?: SlackFetch;
  /**
   * How many times the Web API client retries a call that failed: a transport error, a non-200, or
   * a rate limit it waited out. Forwarded to `@slack/web-api` as `retryConfig: { retries }`.
   * Defaults to the SDK's own policy, ten retries over about thirty minutes.
   *
   * Set `0` when the caller owns retrying (a job queue, or a host that abandons a call at its own
   * deadline): the SDK's retries otherwise carry on in the background after the caller has given
   * up, and can deliver a message long after it stopped being true.
   */
  retries?: number;
  /**
   * Reject a rate-limited Web API call with `WebAPIRateLimitedError` instead of pausing every call
   * until Slack's `Retry-After` has passed. Forwarded as-is. Defaults to `false`, the SDK's own.
   */
  rejectRateLimitedCalls?: boolean;
}

/**
 * The `fetch` shape the client needs. It is `@slack/web-api`'s own `FetchFunction`, so one
 * function serves both the Web API client and the webhook POSTs; the global `fetch` satisfies it.
 */
export type SlackFetch = FetchFunction;

@Injectable()
export abstract class SlackConfig implements SlackConfig {}
