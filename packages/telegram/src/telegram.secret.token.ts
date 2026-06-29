import { timingSafeEqual } from 'node:crypto';
import { TelegramError } from './telegram.error.js';

/**
 * Reason codes attached to {@link TelegramError.internalDetails} when secret-token
 * verification fails.
 */
export type TelegramSecretTokenFailureReason = 'missing_secret_token' | 'invalid_secret_token';

/** Header Telegram sends on every webhook request when a `secret_token` was set on the webhook. */
export const TELEGRAM_SECRET_TOKEN_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

/**
 * Inputs to {@link verifyTelegramSecretToken}. Values are taken verbatim from the
 * request — the helper does no header lookups of its own.
 */
export type VerifyTelegramSecretTokenInput = {
  /** Configured secret token to match against (`TelegramConfig.secretToken`). */
  secretToken: string;
  /** Value of the `X-Telegram-Bot-Api-Secret-Token` header. */
  headerValue: string | undefined;
};

/**
 * Verifies a Telegram webhook request's secret token.
 *
 * Telegram does not sign webhook payloads. Instead, when you register the webhook
 * with `setWebhook({ secret_token })`, it echoes that value in the
 * `X-Telegram-Bot-Api-Secret-Token` header on every delivery. This helper
 * compares the header against the configured token with a constant-time compare.
 *
 * Pure: no request/context coupling. The caller extracts the header from whatever
 * transport it's using and passes it in.
 *
 * @throws {@link TelegramError} when the header is missing or does not match. The
 *   error's `internalDetails.reason` is a {@link TelegramSecretTokenFailureReason};
 *   map to HTTP 401 at the route boundary.
 *
 * @example
 * ```ts
 * try {
 *   verifyTelegramSecretToken({
 *     secretToken: config.secretToken!,
 *     headerValue: req.headers['x-telegram-bot-api-secret-token'],
 *   });
 * } catch (err) {
 *   throw httpError(401).withCause(err);
 * }
 * ```
 */
export const verifyTelegramSecretToken = (input: VerifyTelegramSecretTokenInput): void => {
  const { secretToken, headerValue } = input;

  if (!headerValue) {
    throw new TelegramError('Telegram request missing X-Telegram-Bot-Api-Secret-Token header').withInternalDetails({
      reason: 'missing_secret_token' satisfies TelegramSecretTokenFailureReason,
    });
  }

  const expectedBuf = Buffer.from(secretToken, 'utf8');
  const providedBuf = Buffer.from(headerValue, 'utf8');

  // timingSafeEqual throws on length mismatch — short-circuit so the caller gets
  // a uniform "invalid_secret_token" error instead of a crypto exception.
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    throw new TelegramError('Telegram request secret token does not match').withInternalDetails({
      reason: 'invalid_secret_token' satisfies TelegramSecretTokenFailureReason,
    });
  }
};
