import { invalidAuthenticationSession, type AuthenticationSession } from '@maroonedsoftware/authentication';
import { unauthorizedError } from '@maroonedsoftware/errors';

/**
 * Structural shape of any context that may carry an authentication session —
 * {@link import('./mcp.request.context.js').McpToolContext},
 * {@link import('./mcp.request.context.js').McpResourceContext}, or the
 * {@link import('./mcp.request.context.js').McpRequestContext} they derive from.
 */
export type McpAuthenticatedContext = {
  /** ServerKit authentication session for the request, when one was resolved. */
  authenticationSession?: AuthenticationSession;
};

/**
 * Narrow a handler context to an authenticated session, or throw HTTP 401.
 *
 * Mirrors the session check in `@maroonedsoftware/koa`'s `requirePolicy`, so an
 * MCP tool enforces the same rule its HTTP route does. Call it before
 * `PolicyService.assert(policy, { session })` in a tool or resource handler
 * whose operation declares a policy:
 *
 * ```ts
 * async handle(args: Record<string, unknown>, context: McpToolContext) {
 *   const session = requireMcpAuthenticationSession(context);
 *   await this.policies.assert('payments.write', { session });
 *   // …
 * }
 * ```
 *
 * A missing session is treated exactly like `invalidAuthenticationSession`: a
 * route wired without the authentication stack fails closed rather than
 * granting every caller access.
 *
 * @param context - The handler context to read `authenticationSession` from.
 * @returns The authenticated session.
 * @throws {HttpError} 401 with `WWW-Authenticate: Bearer error="invalid_token"`
 *   when the request carries no valid session. Thrown from inside a handler this
 *   surfaces as a JSON-RPC error, not an HTTP 401 — see the package AGENTS.md.
 */
export const requireMcpAuthenticationSession = (context: McpAuthenticatedContext): AuthenticationSession => {
  const session = context.authenticationSession;

  if (!session || session === invalidAuthenticationSession) {
    throw unauthorizedError('Bearer error="invalid_token"');
  }

  return session;
};
