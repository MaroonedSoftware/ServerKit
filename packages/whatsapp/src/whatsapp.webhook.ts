import { timingSafeEqual } from 'node:crypto';
import { WhatsAppError } from './whatsapp.error.js';

/** Reason codes attached to {@link WhatsAppError.internalDetails} when the verification handshake fails. */
export type WhatsAppVerificationFailureReason = 'invalid_mode' | 'invalid_verify_token' | 'missing_challenge';

/** Query-parameter names Meta sends on the verification (`GET`) request. */
export const WHATSAPP_HUB_MODE_PARAM = 'hub.mode';
export const WHATSAPP_HUB_VERIFY_TOKEN_PARAM = 'hub.verify_token';
export const WHATSAPP_HUB_CHALLENGE_PARAM = 'hub.challenge';

/**
 * Inputs to {@link verifyWhatsAppWebhook}. Values are taken verbatim from the
 * verification request's query string.
 */
export type VerifyWhatsAppWebhookInput = {
  /** Configured token to match against (`WhatsAppConfig.verifyToken`). */
  verifyToken: string;
  /** Value of the `hub.mode` query parameter (Meta sends `"subscribe"`). */
  mode: string | undefined;
  /** Value of the `hub.verify_token` query parameter. */
  token: string | undefined;
  /** Value of the `hub.challenge` query parameter, echoed back on success. */
  challenge: string | undefined;
};

/**
 * Verifies the WhatsApp webhook subscription handshake.
 *
 * When you register a webhook, Meta sends a one-off `GET` with
 * `hub.mode=subscribe`, `hub.verify_token=<yours>`, and a random
 * `hub.challenge`. You must confirm the token matches and respond with the
 * challenge value (HTTP 200, `text/plain`).
 *
 * @returns The `hub.challenge` value to write back as the plain-text response.
 * @throws {@link WhatsAppError} when the mode is not `subscribe`, the token does
 *   not match (constant-time compared), or the challenge is absent. The error's
 *   `internalDetails.reason` is a {@link WhatsAppVerificationFailureReason}; map
 *   to HTTP 403 at the route boundary.
 *
 * @example
 * ```ts
 * router.get('/whatsapp/webhook', (ctx) => {
 *   ctx.body = verifyWhatsAppWebhook({
 *     verifyToken: ctx.container.get(WhatsAppConfig).verifyToken,
 *     mode: ctx.query['hub.mode'],
 *     token: ctx.query['hub.verify_token'],
 *     challenge: ctx.query['hub.challenge'],
 *   });
 * });
 * ```
 */
export const verifyWhatsAppWebhook = (input: VerifyWhatsAppWebhookInput): string => {
  const { verifyToken, mode, token, challenge } = input;

  if (mode !== 'subscribe') {
    throw new WhatsAppError('WhatsApp webhook verification mode is not "subscribe"').withInternalDetails({
      reason: 'invalid_mode' satisfies WhatsAppVerificationFailureReason,
      mode,
    });
  }

  const expectedBuf = Buffer.from(verifyToken, 'utf8');
  const providedBuf = Buffer.from(token ?? '', 'utf8');
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    throw new WhatsAppError('WhatsApp webhook verify token does not match').withInternalDetails({
      reason: 'invalid_verify_token' satisfies WhatsAppVerificationFailureReason,
    });
  }

  if (!challenge) {
    throw new WhatsAppError('WhatsApp webhook verification missing hub.challenge').withInternalDetails({
      reason: 'missing_challenge' satisfies WhatsAppVerificationFailureReason,
    });
  }

  return challenge;
};
