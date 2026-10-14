import { createHmac, BinaryLike, BinaryToTextEncoding } from 'node:crypto';
import { DateTime } from 'luxon';

/** Inputs to {@link signRequestBody}. */
export type SignRequestBodyInput = {
  /** Secret key used to compute the HMAC. */
  secret: string;
  /** The exact bytes that will be sent as the request body. */
  body: BinaryLike;
  /** HMAC algorithm passed to `crypto.createHmac`. Defaults to `'sha256'`. */
  algorithm?: string;
  /** Output encoding for `hmac.digest()`. Defaults to `'hex'`. */
  digest?: BinaryToTextEncoding;
  /**
   * When set, the signature covers `"<unix seconds>.<body>"` instead of the body alone, and the
   * returned {@link SignedRequestBody.timestamp} carries the seconds to send in the timestamp
   * header. Pass `DateTime.now()` for an outbound request; fractional seconds are dropped.
   */
  timestamp?: DateTime;
  /** Literal prepended to the encoded HMAC in the signature header value (e.g. `'v1='`). Defaults to none. */
  prefix?: string;
};

/** Header values produced by {@link signRequestBody}. The caller chooses the header names. */
export type SignedRequestBody = {
  /** Value for the signature header: `prefix` followed by the encoded HMAC. */
  signature: string;
  /** Value for the timestamp header (unix seconds), present only when a timestamp was signed. */
  timestamp?: string;
};

/**
 * Compute the signature header value for `body`. When `timestamp` is given the HMAC covers
 * `"<timestamp>.<body>"`; otherwise it covers the body alone. `timestamp` is the header value
 * verbatim, so a verifier signs exactly the string it received.
 *
 * Shared by {@link signRequestBody} and `DefaultSignaturePolicy` so the two cannot drift.
 *
 * @internal
 */
export const computeRequestSignature = (
  secret: string,
  algorithm: string,
  digest: BinaryToTextEncoding,
  body: BinaryLike,
  timestamp: string | undefined,
  prefix: string,
): string => {
  // `BinaryLike` permits a bare `ArrayBuffer`, which `Hmac.update` does not accept; wrap those in a Buffer.
  const data = typeof body === 'string' || ArrayBuffer.isView(body) ? body : Buffer.from(body);
  const hmac = createHmac(algorithm, secret);
  if (timestamp !== undefined) {
    hmac.update(`${timestamp}.`);
  }
  return `${prefix}${hmac.update(data).digest(digest)}`;
};

/**
 * Sign an outbound request body. The counterpart of `DefaultSignaturePolicy`: a receiver whose
 * `SignatureOptions` use the same `secret`, `algorithm`, `digest`, and `prefix` (and a
 * `timestamp` option when this call signs one) verifies the result through `requireSignature`.
 *
 * Two modes:
 * - **Untimestamped** (no `timestamp`): `signature = prefix + HMAC(secret, body)`. With no
 *   `prefix` this is exactly what the policy has always verified.
 * - **Timestamped**: `signature = prefix + HMAC(secret, "<unix seconds>.<body>")`, and the
 *   seconds are returned for the timestamp header, giving the receiver a replay window.
 *
 * Header names are the caller's choice. Send the body bytes exactly as signed; re-serialising
 * JSON after signing breaks verification.
 *
 * @example
 * ```ts
 * const body = JSON.stringify(event);
 * const { signature, timestamp } = signRequestBody({ secret, body, timestamp: DateTime.now(), prefix: 'v1=' });
 * await fetch(url, {
 *   method: 'POST',
 *   body,
 *   headers: { 'Content-Type': 'application/json', 'Example-Signature': signature, 'Example-Timestamp': timestamp! },
 * });
 * ```
 */
export const signRequestBody = (input: SignRequestBodyInput): SignedRequestBody => {
  const { secret, body, algorithm = 'sha256', digest = 'hex', prefix = '' } = input;
  const timestamp = input.timestamp ? String(Math.floor(input.timestamp.toSeconds())) : undefined;
  const signature = computeRequestSignature(secret, algorithm, digest, body, timestamp, prefix);
  return timestamp === undefined ? { signature } : { signature, timestamp };
};
