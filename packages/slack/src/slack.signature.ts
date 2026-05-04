import { createHmac, timingSafeEqual } from 'node:crypto';
import { SlackError } from './slack.error.js';

/** Default replay-protection window in seconds (5 minutes — matches Slack's recommendation). */
export const SLACK_SIGNATURE_DEFAULT_MAX_AGE_SECONDS = 300;

/**
 * Reason codes attached to {@link SlackError.internalDetails} when verification
 * fails. Useful for callers that want to log structured reasons without
 * pattern-matching on error messages.
 */
export type SlackSignatureFailureReason =
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'stale_timestamp'
  | 'missing_signature'
  | 'invalid_signature';

/**
 * Inputs to {@link verifySlackSignature}. All values are taken verbatim from
 * the request — the helper does no header lookups or body reads of its own.
 */
export type VerifySlackSignatureInput = {
  /** App signing secret (`SlackConfig.signingSecret`). */
  signingSecret: string;
  /** Raw, unparsed request body — exactly as Slack sent it. */
  rawBody: string;
  /** Value of the `X-Slack-Request-Timestamp` header. */
  timestamp: string | undefined;
  /** Value of the `X-Slack-Signature` header (e.g. `"v0=abc123…"`). */
  signature: string | undefined;
  /**
   * Maximum age in seconds before the request is rejected as a replay.
   * Defaults to {@link SLACK_SIGNATURE_DEFAULT_MAX_AGE_SECONDS}.
   */
  maxAgeSeconds?: number;
  /**
   * Override for the current Unix time in seconds. Mostly useful for tests;
   * defaults to `Math.floor(Date.now() / 1000)`.
   */
  now?: number;
};

/**
 * Verifies a Slack request signature against the app signing secret.
 *
 * Implements Slack's v0 scheme:
 * 1. Reject the request if `X-Slack-Request-Timestamp` is missing, non-numeric,
 *    or older than `maxAgeSeconds` (replay protection).
 * 2. Compute `v0=` + `HMAC-SHA256(signingSecret, "v0:{timestamp}:{rawBody}")`
 *    as hex.
 * 3. Compare against the provided `X-Slack-Signature` value using a
 *    constant-time compare.
 *
 * Pure: no request/context coupling. The caller extracts the headers and raw
 * body from whatever transport it's using and passes them in.
 *
 * @throws {@link SlackError} on any failure. The error's `internalDetails.reason`
 *   is one of {@link SlackSignatureFailureReason}; map to HTTP 401 at the route boundary.
 *
 * @example
 * ```ts
 * try {
 *   verifySlackSignature({
 *     signingSecret: config.signingSecret,
 *     rawBody,
 *     timestamp: req.headers['x-slack-request-timestamp'],
 *     signature: req.headers['x-slack-signature'],
 *   });
 * } catch (err) {
 *   throw httpError(401).withCause(err);
 * }
 * ```
 */
export const verifySlackSignature = (input: VerifySlackSignatureInput): void => {
  const {
    signingSecret,
    rawBody,
    timestamp,
    signature,
    maxAgeSeconds = SLACK_SIGNATURE_DEFAULT_MAX_AGE_SECONDS,
    now = Math.floor(Date.now() / 1000),
  } = input;

  if (!timestamp) {
    throw new SlackError('Slack request missing X-Slack-Request-Timestamp header').withInternalDetails({
      reason: 'missing_timestamp' satisfies SlackSignatureFailureReason,
    });
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !Number.isInteger(ts)) {
    throw new SlackError('Slack request timestamp is not a valid integer').withInternalDetails({
      reason: 'invalid_timestamp' satisfies SlackSignatureFailureReason,
      timestamp,
    });
  }

  if (Math.abs(now - ts) > maxAgeSeconds) {
    throw new SlackError('Slack request timestamp is outside the allowed window').withInternalDetails({
      reason: 'stale_timestamp' satisfies SlackSignatureFailureReason,
      timestamp: ts,
      now,
      maxAgeSeconds,
    });
  }

  if (!signature) {
    throw new SlackError('Slack request missing X-Slack-Signature header').withInternalDetails({
      reason: 'missing_signature' satisfies SlackSignatureFailureReason,
    });
  }

  const expected = `v0=${createHmac('sha256', signingSecret).update(`v0:${ts}:${rawBody}`).digest('hex')}`;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signature, 'utf8');

  // timingSafeEqual throws on length mismatch — short-circuit so the caller
  // gets a uniform "invalid_signature" error instead of a crypto exception.
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    throw new SlackError('Slack request signature does not match').withInternalDetails({
      reason: 'invalid_signature' satisfies SlackSignatureFailureReason,
    });
  }
};
