import type { AuthenticationSession } from '@maroonedsoftware/authentication';
import { PolicyService } from '@maroonedsoftware/policies';
import { requireMcpAuthenticationSession, type McpAuthenticatedContext } from './mcp.authentication.session.js';

/**
 * Options for {@link requireMcpPolicy}.
 */
export interface RequireMcpPolicyOptions {
  /**
   * Policy name to evaluate against `{ session }` via `PolicyService.assert`.
   *
   * Defaults to `false` — validate the session only. This differs from the HTTP
   * `requirePolicy()`, whose default is `MFA_SATISFIED_POLICY`, because an MCP
   * caller authenticated by
   * {@link import('./mcp.authentication.handler.js').McpAuthenticationHandler}
   * holds a shared token and so carries no factors: the MFA gate would reject
   * every request. Pass `MFA_SATISFIED_POLICY` explicitly on a server whose MCP
   * callers hold real user sessions.
   */
  policy?: string | false;
}

/**
 * Per-tool guard: require an authenticated session and, optionally, a policy.
 *
 * The route guard on `/mcp` closes the mount, not the individual tool — every
 * tool on the server is reachable through one `tools/call`. A tool whose
 * operation declares a policy has to enforce it itself, and this is the pair to
 * call:
 *
 * ```ts
 * @Injectable()
 * export class RefundPaymentTool implements McpToolHandler {
 *   constructor(private readonly policies: PolicyService) {}
 *
 *   readonly definition = { name: 'refund_payment', inputSchema: { … } };
 *
 *   async handle(args: Record<string, unknown>, context: McpToolContext) {
 *     const session = await requireMcpPolicy(context, this.policies, { policy: 'payments.write' });
 *     // …
 *   }
 * }
 * ```
 *
 * Takes a `PolicyService` rather than a `Container` because a handler context is
 * transport-neutral and carries no injectkit types, while handlers are
 * `@Injectable()` and can inject the service directly.
 *
 * Thrown from inside a handler, both failures surface as a JSON-RPC error on a
 * 200 response rather than an HTTP status — see the package AGENTS.md.
 *
 * @param context  - The tool or resource handler context to read the session from.
 * @param policies - `PolicyService`, injected into the handler.
 * @param options  - Optional; `policy` defaults to `false` (session only).
 * @returns The authenticated session, so the caller need not narrow it again.
 * @throws {HttpError} 401 when the request carries no valid session.
 * @throws {HttpError} 403 when the policy denies, with the policy's details and headers.
 */
export const requireMcpPolicy = async (
  context: McpAuthenticatedContext,
  policies: PolicyService,
  options: RequireMcpPolicyOptions = {},
): Promise<AuthenticationSession> => {
  const session = requireMcpAuthenticationSession(context);
  const policy = options.policy ?? false;

  if (policy !== false) {
    await policies.assert(policy, { session });
  }

  return session;
};
