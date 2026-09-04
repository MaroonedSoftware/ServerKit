import type { Container } from 'injectkit';
import { PolicyService } from '@maroonedsoftware/policies';
import { McpConfig } from './mcp.config.js';
import { MCP_AUTH_POLICY, type McpAuthPolicyContext } from './mcp.auth.policy.js';
import type { McpAuthInfo } from './mcp.auth.js';

/**
 * Gate an MCP request on {@link MCP_AUTH_POLICY} and return the identity the
 * policy resolved, for the route to put on the request context.
 *
 * This is the counterpart to koa's `requireSignature` for a route that wants
 * `context.auth` populated: `requireSignature` can only allow or deny, so the
 * verified identity is lost. Here the policy hands it back through
 * `onResolved`, and the credential is verified exactly once per request.
 *
 * @param container - Request container. Must resolve {@link McpConfig} and
 *   `PolicyService`, and have a policy registered under {@link MCP_AUTH_POLICY}.
 * @param getHeader - Case-insensitive header accessor (koa's `ctx.get`).
 * @returns The resolved {@link McpAuthInfo}, or `undefined` when the policy
 *   allowed the request without authenticating anyone — which is what the
 *   bundled scaffold does when no `bearerToken` is configured.
 * @throws {HttpError} 401 when the policy denies, carrying the policy's
 *   `WWW-Authenticate` challenge.
 *
 * @deprecated Register
 *   {@link import('./mcp.authentication.handler.js').McpAuthenticationHandler} under
 *   the `bearer` scheme and read `context.authenticationSession` instead. This
 *   function re-reads the `Authorization` header, which
 *   `authenticationPlugin` (fastify) and `authenticationMiddleware` (koa) delete
 *   after resolving it, so it only works on a server with no authentication stack.
 *
 * @example
 * ```ts
 * router.post('/mcp', bodyParserMiddleware(['application/json']), async ctx => {
 *   const auth = await assertMcpAuth(ctx.container, name => ctx.get(name));
 *   const context = createMcpRequestContext({
 *     requestId: ctx.requestId,
 *     logger: ctx.logger,
 *     authenticationSession: ctx.authenticationSession,
 *     auth,
 *   });
 *   // … dispatch
 * });
 * ```
 */
export const assertMcpAuth = async (container: Container, getHeader: (name: string) => string): Promise<McpAuthInfo | undefined> => {
  const options = container.get(McpConfig);

  let resolved: McpAuthInfo | undefined;
  const context: McpAuthPolicyContext = {
    getHeader,
    options,
    onResolved: auth => {
      resolved = auth;
    },
  };

  await container.get(PolicyService).assert(MCP_AUTH_POLICY, context, 401);

  return resolved;
};
