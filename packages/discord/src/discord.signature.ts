import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { DateTime } from 'luxon';
import { DiscordError } from './discord.error.js';

/**
 * Reason codes attached to {@link DiscordError.internalDetails} when
 * verification fails. Useful for callers that want to log structured reasons
 * without pattern-matching on error messages.
 */
export type DiscordSignatureFailureReason =
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'stale_timestamp'
  | 'missing_signature'
  | 'invalid_signature'
  | 'invalid_public_key';

/**
 * Fixed SPKI (`SubjectPublicKeyInfo`) DER prefix for an Ed25519 public key. The
 * 32 raw key bytes are appended to this to form a DER document Node's
 * `createPublicKey` accepts. (AlgorithmIdentifier `1.3.101.112` + bit-string
 * header for a 32-byte key.)
 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Number of bytes in a raw Ed25519 public key. */
const ED25519_PUBLIC_KEY_BYTES = 32;

/**
 * Inputs to {@link verifyDiscordSignature}. All values are taken verbatim from
 * the request — the helper does no header lookups or body reads of its own.
 */
export type VerifyDiscordSignatureInput = {
  /** Application Ed25519 public key as hex (`DiscordConfig.publicKey`). */
  publicKey: string;
  /** Raw, unparsed request body — exactly as Discord sent it. */
  rawBody: string;
  /** Value of the `X-Signature-Timestamp` header. */
  timestamp: string | undefined;
  /** Value of the `X-Signature-Ed25519` header (hex-encoded signature). */
  signature: string | undefined;
  /**
   * Optional maximum age in seconds before the request is rejected as a replay.
   * Discord does not require a freshness window, so when omitted **no timestamp
   * age check is performed** (the timestamp is still required and signed).
   */
  maxAgeSeconds?: number;
  /**
   * Override for the current Unix time in seconds. Mostly useful for tests;
   * defaults to `Math.floor(DateTime.now().toSeconds())`. Only consulted when
   * `maxAgeSeconds` is provided.
   */
  now?: number;
};

/**
 * Turns a hex-encoded raw Ed25519 public key into a Node {@link KeyObject} by
 * wrapping it in the standard SPKI DER envelope.
 *
 * @throws {@link DiscordError} (`invalid_public_key`) if the hex is malformed or
 *   not exactly 32 bytes, or if Node rejects the resulting key.
 */
const publicKeyFromHex = (publicKey: string): KeyObject => {
  const raw = Buffer.from(publicKey, 'hex');
  if (raw.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new DiscordError('Discord public key is not a 32-byte Ed25519 key').withInternalDetails({
      reason: 'invalid_public_key' satisfies DiscordSignatureFailureReason,
      byteLength: raw.length,
    });
  }
  try {
    return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
  } catch (error) {
    throw new DiscordError('Discord public key could not be parsed as Ed25519').withInternalDetails({
      reason: 'invalid_public_key' satisfies DiscordSignatureFailureReason,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Verifies a Discord interaction request signature against the application's
 * Ed25519 public key.
 *
 * Implements Discord's scheme:
 * 1. Require the `X-Signature-Timestamp` header (and, when `maxAgeSeconds` is
 *    set, reject timestamps outside the window as replays).
 * 2. Require the `X-Signature-Ed25519` header.
 * 3. Verify the Ed25519 signature over `timestamp + rawBody` using the
 *    application public key.
 *
 * Pure: no request/context coupling. The caller extracts the headers and raw
 * body from whatever transport it's using and passes them in.
 *
 * @throws {@link DiscordError} on any failure. The error's
 *   `internalDetails.reason` is one of {@link DiscordSignatureFailureReason};
 *   map to HTTP 401 at the route boundary.
 *
 * @example
 * ```ts
 * try {
 *   verifyDiscordSignature({
 *     publicKey: config.publicKey,
 *     rawBody,
 *     timestamp: req.headers['x-signature-timestamp'],
 *     signature: req.headers['x-signature-ed25519'],
 *   });
 * } catch (err) {
 *   throw httpError(401).withCause(err);
 * }
 * ```
 */
export const verifyDiscordSignature = (input: VerifyDiscordSignatureInput): void => {
  const { publicKey, rawBody, timestamp, signature, maxAgeSeconds, now = Math.floor(DateTime.now().toSeconds()) } = input;

  if (!timestamp) {
    throw new DiscordError('Discord request missing X-Signature-Timestamp header').withInternalDetails({
      reason: 'missing_timestamp' satisfies DiscordSignatureFailureReason,
    });
  }

  if (maxAgeSeconds !== undefined) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || !Number.isInteger(ts)) {
      throw new DiscordError('Discord request timestamp is not a valid integer').withInternalDetails({
        reason: 'invalid_timestamp' satisfies DiscordSignatureFailureReason,
        timestamp,
      });
    }
    if (Math.abs(now - ts) > maxAgeSeconds) {
      throw new DiscordError('Discord request timestamp is outside the allowed window').withInternalDetails({
        reason: 'stale_timestamp' satisfies DiscordSignatureFailureReason,
        timestamp: ts,
        now,
        maxAgeSeconds,
      });
    }
  }

  if (!signature) {
    throw new DiscordError('Discord request missing X-Signature-Ed25519 header').withInternalDetails({
      reason: 'missing_signature' satisfies DiscordSignatureFailureReason,
    });
  }

  const key = publicKeyFromHex(publicKey);

  // Ed25519 signs the concatenation of the timestamp and the raw body.
  const message = Buffer.from(timestamp + rawBody, 'utf8');

  // `verify` throws on a malformed signature buffer (e.g. odd-length hex) — wrap
  // so the caller always gets a uniform "invalid_signature" instead of a crypto
  // exception, mirroring Slack's timingSafeEqual length guard.
  let ok: boolean;
  try {
    ok = verify(null, message, key, Buffer.from(signature, 'hex'));
  } catch {
    ok = false;
  }

  if (!ok) {
    throw new DiscordError('Discord request signature does not match').withInternalDetails({
      reason: 'invalid_signature' satisfies DiscordSignatureFailureReason,
    });
  }
};
