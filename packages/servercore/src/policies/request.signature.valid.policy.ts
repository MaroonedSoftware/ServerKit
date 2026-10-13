import { timingSafeEqual, BinaryLike, BinaryToTextEncoding } from 'node:crypto';
import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Policy, PolicyEnvelope, PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { computeRequestSignature } from './request.body.signer.js';

/**
 * Replay protection for {@link SignatureOptions}: the header carrying the unix-seconds timestamp
 * the sender signed, and how far that timestamp may drift from now, in either direction.
 */
export type SignatureTimestampOptions = {
  /** Name of the request header that carries the unix-seconds timestamp (e.g. `'Example-Timestamp'`). */
  header: string;
  /** Largest accepted difference between the timestamp and now, in seconds. Applies to past and future skew alike. */
  maxAgeSeconds: number;
};

/**
 * Configuration for the bundled HMAC signature rule, resolved by `requireSignature` from
 * `AppConfig` by key at request time so the values can be loaded from any AppConfig source
 * (JSON, `.env`, GCP secrets, etc.).
 */
export type SignatureOptions = {
  /** Name of the request header that carries the HMAC signature (e.g. `'X-Signature'`). */
  header: string;
  /** Secret key used to compute the HMAC. */
  secret: string;
  /** HMAC algorithm passed to `crypto.createHmac` (e.g. `'sha256'`, `'sha512'`). */
  algorithm: string;
  /** Output encoding for `hmac.digest()` (e.g. `'hex'`, `'base64'`). */
  digest: BinaryToTextEncoding;
  /**
   * Literal the signature header value starts with, ahead of the encoded HMAC (e.g. `'v1='`).
   * Omit for a bare HMAC.
   */
  prefix?: string;
  /**
   * When set, the HMAC covers `"<timestamp>.<rawBody>"` and the timestamp header must be present,
   * an integer, and within `maxAgeSeconds` of the policy envelope's `now`. Omit to sign the raw
   * body alone, with no replay window.
   */
  timestamp?: SignatureTimestampOptions;
};

/**
 * Reasons {@link DefaultSignaturePolicy} denies with. The timestamp reasons occur only when
 * {@link SignatureOptions.timestamp} is set.
 */
export type SignatureFailureReason = 'missing_timestamp' | 'invalid_timestamp' | 'timestamp_out_of_window' | 'invalid_signature';

/**
 * Policy name under which {@link DefaultSignaturePolicy} is registered. Pass to
 * `PolicyService.check`/`assert`, or use as the key when wiring your
 * `PolicyRegistryMap`. `requireSignature` evaluates this policy internally.
 */
export const REQUIRE_SIGNATURE_POLICY = 'request.signature.valid' as const;

/**
 * Context for {@link DefaultSignaturePolicy}: the raw request bytes, a
 * header accessor, and the {@link SignatureOptions} that describe how to
 * recompute and compare the signature.
 *
 * `requireSignature` builds this from the request (the raw body, a header
 * accessor, and the resolved options) and hands the policy everything it needs
 * to verify the request itself — no framework or `AppConfig` coupling. Passing a header
 * accessor rather than a single pre-extracted value lets custom policies read
 * whichever header(s) their scheme requires (e.g. a Slack-style rule that needs
 * both `X-Slack-Request-Timestamp` and `X-Slack-Signature`).
 *
 * `TOptions` defaults to {@link SignatureOptions} for the bundled HMAC rule. A
 * custom scheme with a different config shape (e.g. a Slack signing secret plus
 * a replay window) declares its own options type —
 * `Policy<SignaturePolicyContext<SlackSignatureOptions>>` — and is driven by
 * `requireSignature<SlackSignatureOptions>(optionsKey)`.
 */
export interface SignaturePolicyContext<TOptions = SignatureOptions> {
  /** Raw request bytes the HMAC is computed over (the request's `rawBody`). */
  rawBody: BinaryLike;
  /**
   * Case-insensitive request header accessor; returns `''` when the header is
   * absent. Read `options.header` for the default rule, or
   * any other header a custom scheme needs.
   */
  getHeader: (name: string) => string;
  /** Resolved configuration for the scheme (header name, secret, algorithm, digest for the default rule). */
  options: TOptions;
}

/**
 * Rule backing `requireSignature`: does the supplied signature match an HMAC of the raw body?
 *
 * Without {@link SignatureOptions.timestamp}, computes `prefix + HMAC(algorithm, secret)(rawBody)`
 * encoded with `digest`. With it, first reads the timestamp header and denies when it is missing
 * (`'missing_timestamp'`), not an unsigned integer (`'invalid_timestamp'`), or further than
 * `maxAgeSeconds` from `envelope.now` in either direction (`'timestamp_out_of_window'`), then
 * computes the HMAC over `"<timestamp>.<rawBody>"` using the header value verbatim. `signRequestBody`
 * produces both forms.
 *
 * The comparison uses `crypto.timingSafeEqual` (constant-time) and denies with reason
 * `'invalid_signature'` on any mismatch, including a length mismatch, which covers a
 * missing/empty header without tripping `timingSafeEqual`'s equal-length requirement.
 *
 * Registered by default under {@link REQUIRE_SIGNATURE_POLICY}. Applications can
 * subclass and re-register under the same name to change the rule (e.g. accept
 * a rotated secret during a key rollover) without touching `requireSignature`.
 *
 * On deny, the diagnostics (`header`, `algorithm`, `digest`, the computed and
 * supplied signatures, and the timestamp, `now`, and window when relevant) are attached to
 * `internalDetails`: operator/log-only, never on the wire, and the secret is never included.
 * `requireSignature` surfaces these under the thrown `HttpError.internalDetails`.
 */
@Injectable()
export class DefaultSignaturePolicy extends Policy<SignaturePolicyContext> {
  async evaluate(context: SignaturePolicyContext, envelope: PolicyEnvelope): Promise<PolicyResult> {
    const { rawBody, getHeader, options } = context;
    const { header, secret, algorithm, digest, prefix = '', timestamp: timestampOptions } = options;

    let timestamp: string | undefined;
    if (timestampOptions) {
      const { header: timestampHeader, maxAgeSeconds } = timestampOptions;
      timestamp = getHeader(timestampHeader);

      if (!timestamp) {
        return this.deny('missing_timestamp' satisfies SignatureFailureReason, undefined, {
          message: 'Missing signature timestamp',
          timestampHeader,
        });
      }

      if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
        return this.deny('invalid_timestamp' satisfies SignatureFailureReason, undefined, {
          message: 'Invalid signature timestamp',
          timestampHeader,
          timestamp,
        });
      }

      const now = Math.floor(envelope.now.toSeconds());
      if (Math.abs(now - Number(timestamp)) > maxAgeSeconds) {
        return this.deny('timestamp_out_of_window' satisfies SignatureFailureReason, undefined, {
          message: 'Signature timestamp outside the allowed window',
          timestampHeader,
          timestamp,
          now,
          maxAgeSeconds,
        });
      }
    }

    const signature = getHeader(header);
    const computedSignature = computeRequestSignature(secret, algorithm, digest, rawBody, timestamp, prefix);
    const expected = Buffer.from(computedSignature);
    const provided = Buffer.from(signature ?? '');

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return this.deny('invalid_signature' satisfies SignatureFailureReason, undefined, {
        message: 'Invalid signature',
        header,
        computedSignature,
        signature,
        algorithm,
        digest,
        ...(timestamp === undefined ? {} : { timestamp }),
      });
    }

    return this.allow();
  }
}

/** The request inputs {@link assertRequestSignature} needs: the raw body and a header accessor. */
export interface SignatureRequest {
  /** Raw request bytes, captured by the body parser before any deserialisation. */
  rawBody: BinaryLike;
  /** Case-insensitive request header accessor returning `''` when absent. */
  getHeader: (name: string) => string;
}

/**
 * The framework-neutral body of `requireSignature`: resolve the signature options from
 * `AppConfig` by key, then assert `policy` (default {@link REQUIRE_SIGNATURE_POLICY}) through
 * the request-scoped {@link PolicyService} with status `401`, so a denial throws an HTTP 401
 * carrying the policy's `reason`, `details`, `headers`, and `internalDetails`.
 *
 * Each HTTP adapter wraps this in its own route guard, supplying `container` from the request
 * scope and a `getHeader` closure over its request object.
 *
 * @typeParam TOptions - Shape of the config resolved from `AppConfig`; defaults to {@link SignatureOptions}.
 * @param container - The request-scoped container that resolves `AppConfig` and `PolicyService`.
 * @param request - The raw body and header accessor for the request under test.
 * @param optionsKey - Key used to retrieve `TOptions` from `AppConfig` via `getAs`.
 * @param policy - Policy name to assert; defaults to {@link REQUIRE_SIGNATURE_POLICY}.
 * @throws {HttpError} 401 when the policy denies.
 */
export const assertRequestSignature = async <TOptions = SignatureOptions>(
  container: Container,
  request: SignatureRequest,
  optionsKey: string,
  policy: string = REQUIRE_SIGNATURE_POLICY,
): Promise<void> => {
  const options = container.get(AppConfig).getAs<TOptions>(optionsKey);

  const policyService = container.get(PolicyService);
  await policyService.assert(
    policy,
    {
      rawBody: request.rawBody,
      getHeader: request.getHeader,
      options,
    } satisfies SignaturePolicyContext<TOptions>,
    401,
  );
};
