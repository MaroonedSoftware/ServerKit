import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { Injectable } from 'injectkit';
import { invalidAuthenticationSession, type AuthenticationHandler, type AuthenticationSession, type AuthorizationScheme } from '@maroonedsoftware/authentication';
import { Logger } from '@maroonedsoftware/logger';
import { McpConfig, MCP_DEFAULT_REQUEST_TIMEOUT_MS } from './mcp.config.js';
import { compareMcpToken, isBlankBearerToken } from './mcp.auth.js';
import { McpError } from './mcp.error.js';

/** {@link McpConfig.subject} when the app does not name the MCP client itself. */
export const MCP_DEFAULT_SUBJECT = 'mcp' as const;

/**
 * Resolves the MCP shared bearer token into an `AuthenticationSession`, so the
 * MCP endpoint authenticates through the same stack as every other route.
 *
 * Register it under the `bearer` scheme — via
 * `ChainedAuthenticationHandler` when the server also serves JWT bearer traffic,
 * since a scheme holds one handler:
 *
 * ```ts
 * registry.register(McpAuthenticationHandler).useClass(McpAuthenticationHandler).asSingleton();
 * registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain)
 *   .push(McpAuthenticationHandler)
 *   .push(JwtAuthenticationHandler);
 * registry.register(ChainedAuthenticationHandler).useClass(ChainedAuthenticationHandler).asSingleton();
 * registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', ChainedAuthenticationHandler);
 * ```
 *
 * This is what makes MCP work behind `authenticationPlugin` / `authenticationMiddleware`:
 * those hand the `Authorization` header to `AuthenticationSchemeHandler` and then
 * **delete it**, keeping only the resolved session. Anything re-reading the header
 * afterwards — the deprecated
 * {@link import('./mcp.auth.assert.js').assertMcpAuth} path — sees nothing.
 *
 * **Still scaffold-grade.** One static token, compared in constant time, identifying
 * one client. Replace with an OAuth 2.0 resource-server handler (validate the access
 * token's signature, `aud`, `exp`, and scopes) by writing another
 * `AuthenticationHandler`; nothing downstream of `authenticationSession` changes.
 */
@Injectable()
export class McpAuthenticationHandler implements AuthenticationHandler {
  constructor(
    private readonly config: McpConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Validate a presented bearer token against {@link McpConfig.bearerToken}.
   *
   * @param scheme - The authorization scheme; anything but `'bearer'` declines.
   * @param value  - The raw credential, already stripped of its scheme by
   *   `AuthenticationSchemeHandler`. Compared verbatim.
   * @returns A session identifying the MCP client, or `invalidAuthenticationSession`
   *   when the scheme is not `bearer`, the token does not match, or the endpoint is
   *   deliberately running unauthenticated (which authenticates nobody).
   * @throws {@link McpError} when the configuration is unusable: a blank
   *   `bearerToken`, or no token without {@link McpConfig.allowUnauthenticated}. Both
   *   are the server's fault, not the caller's, and surface as a 500.
   */
  async authenticate(scheme: AuthorizationScheme, value: string): Promise<AuthenticationSession> {
    if (scheme !== 'bearer') return invalidAuthenticationSession;

    const { bearerToken, allowUnauthenticated } = this.config;

    if (isBlankBearerToken(bearerToken)) {
      // A token was configured and is empty — a blank environment variable, not a
      // decision to run open. Fail closed and surface it as the server fault it is,
      // rather than letting it read as the `undefined` open-mode case below.
      throw new McpError('McpConfig.bearerToken is configured but blank').withInternalDetails({ kind: 'misconfiguration', field: 'bearerToken' });
    }

    if (bearerToken === undefined) {
      if (!allowUnauthenticated) {
        // No token, and nobody said they meant it. An endpoint is never open by
        // omission: running unauthenticated has to be stated in config, where it
        // can be reviewed and grepped for. A missing key cannot be.
        throw new McpError('MCP endpoint has no bearerToken configured; set McpConfig.allowUnauthenticated to run without authentication').withInternalDetails({
          kind: 'misconfiguration',
          field: 'allowUnauthenticated',
        });
      }

      // Unauthenticated by explicit request (development). Resolve nobody:
      // presenting a token to an endpoint that has none configured proves nothing,
      // so minting a session here would hand every caller an authenticated identity.
      // The `/mcp` route must be mounted without a session guard to run this way.
      return invalidAuthenticationSession;
    }

    if (!compareMcpToken(value, bearerToken)) {
      // `debug`, not `warn`: behind a chain every JWT-bearing request reaches this
      // handler too, so a mismatch is the ordinary case, not a signal.
      this.logger.debug('MCP bearer token did not match');
      return invalidAuthenticationSession;
    }

    return this.createSession();
  }

  /**
   * Mint the session for an authenticated MCP client.
   *
   * Every field is answered honestly for a shared secret rather than dressed up to
   * look like a user session:
   *
   * - `factors` is empty, because none of the `AuthenticationFactorMethod` values
   *   describes a static token. This is why `requirePolicy()`'s default MFA gate
   *   rejects the session, and why `requireMcpPolicy` defaults to no policy.
   * - `sessionToken` is random, never the bearer token: it must not leak the
   *   credential into anything that logs a session, and it references nothing
   *   stored, so it cannot be mistaken for a revocable session key.
   * - the lifetime is the request's, since the session is minted per request and
   *   never persisted.
   * - `claims.mcp` marks the session so an app's policy override can recognise it.
   */
  private createSession(): AuthenticationSession {
    const issuedAt = DateTime.now();

    return {
      subject: this.config.subject ?? MCP_DEFAULT_SUBJECT,
      sessionToken: randomUUID(),
      issuedAt,
      lastAccessedAt: issuedAt,
      expiresAt: issuedAt.plus({ milliseconds: this.config.requestTimeoutMs ?? MCP_DEFAULT_REQUEST_TIMEOUT_MS }),
      factors: [],
      claims: { mcp: true },
    };
  }
}
