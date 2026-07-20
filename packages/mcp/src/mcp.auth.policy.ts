import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { IsMcpError } from './mcp.error.js';
import { MCP_AUTHORIZATION_HEADER, verifyMcpBearer, type McpAuthFailureReason, type McpAuthOptions } from './mcp.auth.js';

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
 * resource-server validation without touching the route wiring.
 */
@Injectable()
export class McpAuthPolicy extends Policy<McpAuthPolicyContext> {
  async evaluate(context: McpAuthPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    const { getHeader, options } = context;

    if (!options.bearerToken) {
      // No token configured → endpoint is intentionally open (development). Allow.
      return this.allow();
    }

    try {
      verifyMcpBearer({ authorization: getHeader(MCP_AUTHORIZATION_HEADER), expectedToken: options.bearerToken });
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
