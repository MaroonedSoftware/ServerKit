import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { IsMcpError, McpError } from './mcp.error.js';
import {
  isBlankBearerToken,
  MCP_AUTHORIZATION_HEADER,
  verifyMcpBearer,
  type McpAuthFailureReason,
  type McpAuthInfo,
  type McpAuthOptions,
} from './mcp.auth.js';

/**
 * Policy name under which {@link McpAuthPolicy} is registered. Use as the key
 * when wiring your `PolicyRegistryMap`, and pass to `PolicyService.check` — or to
 * koa's `requireSignature` as the `{ policy }` option.
 */
export const MCP_AUTH_POLICY = 'mcp.auth.valid' as const;

/**
 * Context for {@link McpAuthPolicy}: a case-insensitive header accessor and the
 * {@link McpAuthOptions}. `rawBody` is accepted but ignored so the context is
 * **structurally compatible** with `@maroonedsoftware/koa`'s
 * `SignaturePolicyContext<McpAuthOptions>` — this lets the koa `requireSignature`
 * middleware drive MCP bearer auth without the MCP package depending on koa:
 *
 * ```ts
 * router.post('/mcp', requireSignature<McpAuthOptions>('mcp', { policy: MCP_AUTH_POLICY }), handler);
 * ```
 */
export interface McpAuthPolicyContext {
  /** Case-insensitive request header accessor (Koa's `ctx.get`); returns `''` when absent. */
  getHeader: (name: string) => string;
  /** MCP auth configuration (the shared bearer token). */
  options: McpAuthOptions;
  /** Present when driven by `requireSignature`; unused by bearer auth. */
  rawBody?: unknown;
  /**
   * Called with the resolved identity when the policy allows an authenticated
   * request, so the route can put it on the request context without verifying
   * the credential a second time. Not called in open mode (no configured
   * token), which authenticates nobody.
   *
   * {@link import('./mcp.auth.assert.js').assertMcpAuth} supplies it. Driven by
   * koa's `requireSignature` the field is simply absent, which is why it is
   * optional and why the context stays structurally compatible with
   * `SignaturePolicyContext`.
   */
  onResolved?: (auth: McpAuthInfo) => void;
}

/**
 * Policy form of {@link verifyMcpBearer}: gates an MCP request on a valid bearer
 * token. Delegates to the pure verifier so the auth logic has a single source of
 * truth, but answers as a {@link PolicyResult} rather than throwing — allows on
 * success, denies on failure with the verifier's {@link McpAuthFailureReason} as
 * the denial `reason` and a `WWW-Authenticate` challenge header.
 *
 * Registered by default under {@link MCP_AUTH_POLICY}. Subclass and re-register
 * under the same name to swap the scaffold's static-token check for real OAuth
 * resource-server validation without touching the route wiring. A subclass
 * should call `context.onResolved?.(auth)` with the identity it resolved, so the
 * route can thread it onto the request context.
 */
@Injectable()
export class McpAuthPolicy extends Policy<McpAuthPolicyContext> {
  async evaluate(context: McpAuthPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    const { getHeader, options, onResolved } = context;

    if (isBlankBearerToken(options.bearerToken)) {
      // A token was configured and is empty — a blank environment variable, not a
      // decision to run open. Fail closed and surface it as the server fault it is,
      // rather than letting it read as the `undefined` open-mode case below.
      throw new McpError('McpConfig.bearerToken is configured but blank').withInternalDetails({ kind: 'misconfiguration', field: 'bearerToken' });
    }

    if (options.bearerToken === undefined) {
      if (!options.allowUnauthenticated) {
        // No token, and nobody said they meant it. An endpoint is never open by
        // omission: running unauthenticated has to be stated in config, where it
        // can be reviewed and grepped for. A missing key cannot be.
        throw new McpError(
          'MCP endpoint has no bearerToken configured; set McpConfig.allowUnauthenticated to run without authentication',
        ).withInternalDetails({
          kind: 'misconfiguration',
          field: 'allowUnauthenticated',
        });
      }

      // Unauthenticated by explicit request (development). Allow, but resolve
      // nobody: `onResolved` stays uncalled on purpose. Presenting a token to an
      // endpoint that has none configured proves nothing, so passing it to
      // `onResolved` here would put an unverified credential on `context.auth` and
      // every handler gating on that field would let the caller through.
      return this.allow();
    }

    try {
      const auth = verifyMcpBearer({ authorization: getHeader(MCP_AUTHORIZATION_HEADER), expectedToken: options.bearerToken });
      onResolved?.(auth);
      return this.allow();
    } catch (error) {
      if (!IsMcpError(error)) throw error;

      const internalDetails = error.internalDetails ?? {};
      const reason = typeof internalDetails.reason === 'string' ? internalDetails.reason : ('invalid_token' satisfies McpAuthFailureReason);
      return this.deny(reason, undefined, { message: error.message, ...internalDetails }).withHeaders({
        'WWW-Authenticate': `Bearer error="${reason}"`,
      });
    }
  }
}
