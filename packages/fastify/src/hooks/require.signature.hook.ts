import { assertRequestSignature, REQUIRE_SIGNATURE_POLICY, type SignatureOptions } from '@maroonedsoftware/servercore';
import type { preHandlerAsyncHookHandler } from 'fastify';
import { requestHeader } from '../request/request.accessors.js';

/**
 * Options for {@link requireSignature}.
 */
export type RequireSignatureOptions = {
  /**
   * Name of the policy to evaluate. Defaults to {@link REQUIRE_SIGNATURE_POLICY}
   * (the bundled HMAC rule). Point it at any registered policy whose context is
   * `SignaturePolicyContext` to verify a different scheme through the same
   * guard — e.g. `SLACK_SIGNATURE_POLICY` from `@maroonedsoftware/slack`.
   */
  policy?: string;
};

/**
 * Route guard that verifies a request signature against an HMAC of `request.rawBody`.
 *
 * Reads {@link SignatureOptions} from `AppConfig` using `optionsKey`, then hands the raw
 * body, a header accessor, and the resolved options to the named policy (default
 * `DefaultSignaturePolicy` under `REQUIRE_SIGNATURE_POLICY`) resolved from
 * `request.container` via `PolicyService`, asserting with status `401` — the shared
 * `assertRequestSignature` from `@maroonedsoftware/servercore`.
 *
 * Requires `request.rawBody`, which `bodyParserPlugin` populates, so the route must accept the
 * payload through its `config.body`.
 *
 * @typeParam TOptions - Shape of the config resolved from `AppConfig`; defaults to {@link SignatureOptions}.
 * @param optionsKey - Key used to retrieve the options (`TOptions`) from `AppConfig` via `getAs`.
 * @param opts - Optional. {@link RequireSignatureOptions} configuring the guard.
 * @returns A Fastify hook handler to put in a route's `preHandler`.
 *
 * @example
 * ```typescript
 * app.post('/webhooks/github', { config: { body: ['application/json'] }, preHandler: [requireSignature('webhook')] }, handler);
 * ```
 */
export const requireSignature = <TOptions = SignatureOptions>(
  optionsKey: string,
  { policy = REQUIRE_SIGNATURE_POLICY }: RequireSignatureOptions = {},
): preHandlerAsyncHookHandler => {
  return async request => {
    await assertRequestSignature<TOptions>(
      request.container,
      { rawBody: request.rawBody, getHeader: (name: string) => requestHeader(request, name) },
      optionsKey,
      policy,
    );
  };
};
