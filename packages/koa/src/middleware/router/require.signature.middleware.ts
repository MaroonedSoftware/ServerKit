import { BinaryToTextEncoding } from 'node:crypto';
import { ServerKitRouterMiddleware } from '../../serverkit.middleware.js';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PolicyService } from '@maroonedsoftware/policies';
import { REQUIRE_SIGNATURE_POLICY, SignaturePolicyContext } from '../../policies/request.signature.valid.policy.js';

/**
 * Configuration for {@link requireSignature}.
 *
 * Stored in `AppConfig` and retrieved by key at request time, so the values
 * can be loaded from any AppConfig source (JSON, `.env`, GCP secrets, etc.).
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
};

/**
 * Options for {@link requireSignature}.
 */
export type RequireSignatureOptions = {
  /**
   * Name of the policy to evaluate. Defaults to {@link REQUIRE_SIGNATURE_POLICY}
   * (the bundled HMAC rule). Point it at any registered policy whose context is
   * `SignaturePolicyContext` to verify a different scheme through the same
   * middleware — e.g. `SLACK_SIGNATURE_POLICY` from `@maroonedsoftware/slack`.
   */
  policy?: string;
};

/**
 * Router middleware that verifies a request signature against an HMAC of `ctx.rawBody`.
 *
 * Reads {@link SignatureOptions} from `AppConfig` using `optionsKey`, then
 * hands the raw body, a header accessor, and the resolved options to the
 * {@link import('../../policies/request.signature.valid.policy.js').REQUIRE_SIGNATURE_POLICY}
 * policy (default {@link import('../../policies/request.signature.valid.policy.js').DefaultSignaturePolicy})
 * resolved from `ctx.container` via {@link PolicyService}:
 *
 * - Computes `HMAC(algorithm, secret).update(ctx.rawBody).digest(digest)`
 *   and compares it to the supplied signature with `crypto.timingSafeEqual`
 *   (constant-time).
 * - Asserts the policy via {@link PolicyService.assert} with status `401`, so a
 *   denial throws an HTTP 401 carrying the policy's `reason`, `details`,
 *   `headers`, and `internalDetails`.
 * - Calls `next()` otherwise.
 *
 * Because the rule lives in a registered policy, applications can subclass
 * `DefaultSignaturePolicy` and re-register it under the same name to change the
 * verification behaviour without touching this middleware. The policy must be
 * registered in your `PolicyRegistryMap` (e.g.
 * `{ [REQUIRE_SIGNATURE_POLICY]: DefaultSignaturePolicy }`) for this middleware
 * to resolve it.
 *
 * Requires `ctx.rawBody` to be populated before this middleware runs — use
 * {@link bodyParserMiddleware} upstream to ensure the raw bytes are captured.
 *
 * @typeParam TOptions - Shape of the config resolved from `AppConfig`, passed to
 *   the policy as `SignaturePolicyContext.options`. Defaults to
 *   {@link SignatureOptions} for the bundled HMAC rule; a custom policy can
 *   declare a richer shape (e.g. a Slack signing secret plus a replay window).
 * @param optionsKey - Key used to retrieve the options (`TOptions`) from `AppConfig` via `getAs`.
 * @param opts - Optional. {@link RequireSignatureOptions} configuring the middleware.
 * @param opts.policy - Name of the policy to evaluate; defaults to
 *   {@link REQUIRE_SIGNATURE_POLICY} (the bundled HMAC rule). Point it at any
 *   registered policy whose context is `SignaturePolicyContext` to verify a
 *   different scheme through the same middleware — e.g. `SLACK_SIGNATURE_POLICY`
 *   from `@maroonedsoftware/slack`, paired with a matching `TOptions`.
 * @returns A {@link ServerKitRouterMiddleware} that guards the route.
 *
 * @example
 * ```typescript
 * // config.json
 * // { "webhook": { "header": "X-Hub-Signature-256", "secret": "${env:WEBHOOK_SECRET}", "algorithm": "sha256", "digest": "hex" } }
 *
 * router.post('/webhooks/github', requireSignature('webhook'), handler);
 *
 * // Slack's v0 scheme via SlackSignaturePolicy registered under SLACK_SIGNATURE_POLICY:
 * router.post(
 *   '/slack/events',
 *   requireSignature<SlackSignatureOptions>('slack', { policy: SLACK_SIGNATURE_POLICY }),
 *   handler,
 * );
 * ```
 */
export const requireSignature = <TOptions = SignatureOptions>(
  optionsKey: string,
  { policy = REQUIRE_SIGNATURE_POLICY }: RequireSignatureOptions = {},
): ServerKitRouterMiddleware => {
  return async (ctx, next) => {
    const options = ctx.container.get(AppConfig).getAs<TOptions>(optionsKey);

    const policyService = ctx.container.get(PolicyService);
    await policyService.assert(
      policy,
      {
        rawBody: ctx.rawBody,
        getHeader: (name: string) => ctx.get(name),
        options,
      } satisfies SignaturePolicyContext<TOptions>,
      401,
    );

    await next();
  };
};
