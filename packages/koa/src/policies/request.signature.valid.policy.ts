import { createHmac, timingSafeEqual, BinaryLike } from 'node:crypto';
import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import type { SignatureOptions } from '../middleware/router/require.signature.middleware.js';

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
 * `requireSignature` builds this from the request (`ctx.rawBody`, `ctx.get`,
 * and the resolved options) and hands the policy everything it needs to verify
 * the request itself — no Koa or `AppConfig` coupling. Passing a header
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
  /** Raw request bytes the HMAC is computed over (from `ctx.rawBody`). */
  rawBody: BinaryLike;
  /**
   * Case-insensitive request header accessor (Koa's `ctx.get`); returns `''`
   * when the header is absent. Read `options.header` for the default rule, or
   * any other header a custom scheme needs.
   */
  getHeader: (name: string) => string;
  /** Resolved configuration for the scheme (header name, secret, algorithm, digest for the default rule). */
  options: TOptions;
}

/**
 * Rule backing {@link import('../middleware/router/require.signature.middleware.js').requireSignature}:
 * does the supplied signature match an HMAC of the raw body?
 *
 * Computes `HMAC(algorithm, secret).update(rawBody).digest(digest)` and
 * compares it to the supplied signature with `crypto.timingSafeEqual`
 * (constant-time). Denies with reason `'invalid_signature'` on any mismatch —
 * including a length mismatch, which covers a missing/empty header without
 * tripping `timingSafeEqual`'s equal-length requirement.
 *
 * Registered by default under {@link REQUIRE_SIGNATURE_POLICY}. Applications can
 * subclass and re-register under the same name to change the rule (e.g. accept
 * a rotated secret during a key rollover) without touching `requireSignature`.
 *
 * On deny, the diagnostics (`header`, `algorithm`, `digest`, the computed and
 * supplied signatures) are attached to `internalDetails` — operator/log-only,
 * never on the wire, and the secret is never included. `requireSignature`
 * surfaces these under the thrown `HttpError.internalDetails`.
 */
@Injectable()
export class DefaultSignaturePolicy extends Policy<SignaturePolicyContext> {
  async evaluate(context: SignaturePolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    const { rawBody, getHeader, options } = context;
    const { header, secret, algorithm, digest } = options;

    const signature = getHeader(header);
    // `BinaryLike` permits a bare `ArrayBuffer`, which `Hmac.update` does not accept; wrap those in a Buffer.
    const data = typeof rawBody === 'string' || ArrayBuffer.isView(rawBody) ? rawBody : Buffer.from(rawBody);
    const computedSignature = createHmac(algorithm, secret).update(data).digest(digest);
    const expected = Buffer.from(computedSignature);
    const provided = Buffer.from(signature ?? '');

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return this.deny('invalid_signature', undefined, {
        message: 'Invalid signature',
        header,
        computedSignature,
        signature,
        algorithm,
        digest,
      });
    }

    return this.allow();
  }
}
