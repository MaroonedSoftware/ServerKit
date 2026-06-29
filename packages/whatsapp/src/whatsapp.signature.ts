import { createHmac, timingSafeEqual } from 'node:crypto';
import { WhatsAppError } from './whatsapp.error.js';

/**
 * Reason codes attached to {@link WhatsAppError.internalDetails} when signature
 * verification fails. Useful for callers that want to log structured reasons
 * without pattern-matching on error messages.
 */
export type WhatsAppSignatureFailureReason = 'missing_signature' | 'invalid_signature';

/** Header carrying the `sha256=`-prefixed payload HMAC Meta sends with each webhook. */
export const WHATSAPP_SIGNATURE_HEADER = 'X-Hub-Signature-256';

/**
 * Inputs to {@link verifyWhatsAppSignature}. All values are taken verbatim from
 * the request — the helper does no header lookups or body reads of its own.
 */
export type VerifyWhatsAppSignatureInput = {
  /** App secret (`WhatsAppConfig.appSecret`). */
  appSecret: string;
  /** Raw, unparsed request body — exactly as Meta sent it. */
  rawBody: string;
  /** Value of the `X-Hub-Signature-256` header (e.g. `"sha256=abc123…"`). */
  signature: string | undefined;
};

/**
 * Verifies a WhatsApp Cloud API webhook signature against the app secret.
 *
 * Meta signs the raw request body with `HMAC-SHA256(appSecret, rawBody)` and
 * sends the hex digest as `X-Hub-Signature-256: sha256=<hex>`. Unlike Slack
 * there is no timestamp in the scheme, so there is no replay window.
 *
 * Pure: no request/context coupling. The caller extracts the header and raw body
 * from whatever transport it's using and passes them in.
 *
 * @throws {@link WhatsAppError} on any failure. The error's
 *   `internalDetails.reason` is one of {@link WhatsAppSignatureFailureReason};
 *   map to HTTP 401 at the route boundary.
 *
 * @example
 * ```ts
 * try {
 *   verifyWhatsAppSignature({
 *     appSecret: config.appSecret,
 *     rawBody,
 *     signature: req.headers['x-hub-signature-256'],
 *   });
 * } catch (err) {
 *   throw httpError(401).withCause(err);
 * }
 * ```
 */
export const verifyWhatsAppSignature = (input: VerifyWhatsAppSignatureInput): void => {
  const { appSecret, rawBody, signature } = input;

  if (!signature) {
    throw new WhatsAppError('WhatsApp request missing X-Hub-Signature-256 header').withInternalDetails({
      reason: 'missing_signature' satisfies WhatsAppSignatureFailureReason,
    });
  }

  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signature, 'utf8');

  // timingSafeEqual throws on length mismatch — short-circuit so the caller gets
  // a uniform "invalid_signature" error instead of a crypto exception.
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    throw new WhatsAppError('WhatsApp request signature does not match').withInternalDetails({
      reason: 'invalid_signature' satisfies WhatsAppSignatureFailureReason,
    });
  }
};
