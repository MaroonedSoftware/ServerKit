/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { Injectable } from 'injectkit';

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
 * container.register(SlackConfig, { useValue: slackConfig });
 * ```
 *
 * Services in this package take `SlackConfig` directly in their constructor.
 */
export interface SlackConfig {
  /** Bot user OAuth token (`xoxb-...`). Required for Web API calls. */
  botToken: string;
  /** App-level signing secret used to verify request signatures. */
  signingSecret: string;
  /** Optional incoming webhook URL used as the default target for `SlackClient.postWebhook`. */
  incomingWebhookUrl?: string;
  /**
   * Maximum age (in seconds) for request timestamps before signature
   * verification rejects them as replays. Defaults to `300` (5 minutes).
   */
  signatureMaxAgeSeconds?: number;
}

@Injectable()
export abstract class SlackConfig implements SlackConfig {}
