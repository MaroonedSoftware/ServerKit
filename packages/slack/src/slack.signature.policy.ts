import { BinaryLike } from 'node:crypto';
import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { SlackConfig } from './slack.config.js';
import { IsSlackError } from './slack.error.js';
import { verifySlackSignature, type SlackSignatureFailureReason } from './slack.signature.js';

/**
 * Policy name under which {@link SlackSignaturePolicy} is registered. Use as the
 * key when wiring your `PolicyRegistryMap`, and pass to `PolicyService.check`.
 */
export const SLACK_SIGNATURE_POLICY = 'slack.signature.valid' as const;

/** Header carrying the request timestamp Slack signs into the HMAC. */
export const SLACK_REQUEST_TIMESTAMP_HEADER = 'X-Slack-Request-Timestamp';
/** Header carrying the `v0=`-prefixed request signature. */
export const SLACK_SIGNATURE_HEADER = 'X-Slack-Signature';

/**
 * Configuration the {@link SlackSignaturePolicy} reads. A structural subset of
 * {@link SlackConfig}, so a `SlackConfig` value satisfies it directly — e.g.
 * `requireSignature<SlackSignatureOptions>('slack')` with the Slack config
 * stored under that `AppConfig` key.
 */
export type SlackSignatureOptions = Pick<SlackConfig, 'signingSecret' | 'signatureMaxAgeSeconds'>;

/**
 * Context for {@link SlackSignaturePolicy}: the raw request bytes, a
 * case-insensitive header accessor, and the {@link SlackSignatureOptions}.
 *
 * Structurally compatible with `@maroonedsoftware/koa`'s
 * `SignaturePolicyContext<SlackSignatureOptions>`, so the koa `requireSignature`
 * middleware can drive this policy without the slack package depending on koa —
 * register `SlackSignaturePolicy` under the signature policy name and point the
 * middleware at the `AppConfig` key holding the Slack config.
 */
export interface SlackSignaturePolicyContext {
  /** Raw, unparsed request body — exactly as Slack sent it (from `ctx.rawBody`). */
  rawBody: BinaryLike;
  /**
   * Case-insensitive request header accessor (Koa's `ctx.get`); returns `''`
   * when the header is absent.
   */
  getHeader: (name: string) => string;
  /** Slack signing configuration. */
  options: SlackSignatureOptions;
}

/**
 * Policy form of {@link verifySlackSignature}: verifies a Slack request against
 * the app signing secret using Slack's v0 scheme (HMAC over
 * `v0:{timestamp}:{rawBody}`, `v0=`-prefixed, with timestamp replay
 * protection).
 *
 * Delegates to {@link verifySlackSignature} so the crypto/timestamp logic has a
 * single source of truth, but answers as a {@link PolicyResult} rather than
 * throwing: allows on success, denies on failure with the helper's
 * {@link SlackSignatureFailureReason} as the denial `reason` and its diagnostics
 * (timestamps, window) on `internalDetails` — never the signing secret, never
 * on the wire. The replay window is anchored to `envelope.now` so all policies
 * in an evaluation share one clock.
 *
 * Registered by default under {@link SLACK_SIGNATURE_POLICY}.
 *
 * @example
 * ```ts
 * // Direct evaluation in a route handler:
 * const result = await policyService.check(SLACK_SIGNATURE_POLICY, {
 *   rawBody: ctx.rawBody,
 *   getHeader: name => ctx.get(name),
 *   options: ctx.container.get(SlackConfig),
 * });
 * if (isPolicyResultDenied(result)) throw httpError(401);
 * ```
 */
@Injectable()
export class SlackSignaturePolicy extends Policy<SlackSignaturePolicyContext> {
  async evaluate(context: SlackSignaturePolicyContext, envelope: PolicyEnvelope): Promise<PolicyResult> {
    const { rawBody, getHeader, options } = context;

    // Slack signs the raw text body; `ctx.rawBody` may arrive as a Buffer.
    const body = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody as Uint8Array).toString('utf8');

    try {
      verifySlackSignature({
        signingSecret: options.signingSecret,
        rawBody: body,
        timestamp: getHeader(SLACK_REQUEST_TIMESTAMP_HEADER),
        signature: getHeader(SLACK_SIGNATURE_HEADER),
        maxAgeSeconds: options.signatureMaxAgeSeconds,
        now: Math.floor(envelope.now.toSeconds()),
      });
      return this.allow();
    } catch (error) {
      if (!IsSlackError(error)) throw error;

      const internalDetails = error.internalDetails ?? {};
      const reason = typeof internalDetails.reason === 'string' ? internalDetails.reason : ('invalid_signature' satisfies SlackSignatureFailureReason);
      return this.deny(reason, undefined, { message: error.message, ...internalDetails });
    }
  }
}
