import { Injectable } from 'injectkit';
import type { AuthenticationHandler, AuthorizationScheme } from './authentication.handler.js';
import { invalidAuthenticationSession, type AuthenticationSession } from './types.js';

/**
 * Ordered list of {@link AuthenticationHandler}s for {@link ChainedAuthenticationHandler}
 * to try. Registered as an injectkit array so members are added by token:
 *
 * ```ts
 * registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain)
 *   .push(McpAuthenticationHandler)
 *   .push(JwtAuthenticationHandler);
 * ```
 *
 * Registration order is resolution order, so put the cheapest or most specific
 * handler first.
 */
@Injectable()
export class AuthenticationHandlerChain extends Array<AuthenticationHandler> {}

/**
 * An {@link AuthenticationHandler} that delegates to several others in order and
 * takes the first one that authenticates.
 *
 * {@link import('./authentication.scheme.handler.js').AuthenticationHandlerMap} holds
 * one handler per scheme, but a scheme can carry more than one kind of credential —
 * `Bearer` covers both a session JWT and a service's static token. Register this as
 * the handler for that scheme and put the real handlers in an
 * {@link AuthenticationHandlerChain}:
 *
 * ```ts
 * registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain)
 *   .push(McpAuthenticationHandler)
 *   .push(JwtAuthenticationHandler);
 * registry.register(ChainedAuthenticationHandler).useClass(ChainedAuthenticationHandler).asSingleton();
 * registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', ChainedAuthenticationHandler);
 * ```
 *
 * A handler that does not recognise the credential is expected to return
 * {@link invalidAuthenticationSession}, which is the contract every bundled handler
 * already follows, so "not mine" and "mine but invalid" are indistinguishable to the
 * chain. That is deliberate: a credential that is genuinely invalid should not be
 * confirmed as such to the caller by a handler further down refusing to look at it.
 *
 * A handler that **throws** stops the chain and propagates. Handlers throw for
 * misconfiguration rather than for a bad credential, and an operator error must not
 * be silently swallowed by the next handler in line returning the sentinel.
 */
@Injectable()
export class ChainedAuthenticationHandler implements AuthenticationHandler {
  constructor(private readonly handlers: AuthenticationHandlerChain) {}

  /**
   * Try each handler in registration order and return the first session that is not
   * {@link invalidAuthenticationSession}.
   *
   * @param scheme - The authorization scheme, forwarded verbatim to each handler.
   * @param value  - The raw credential, forwarded verbatim to each handler.
   * @returns The first valid {@link AuthenticationSession}, or
   *   {@link invalidAuthenticationSession} when every handler declined (or the chain
   *   is empty).
   * @throws Whatever a handler throws, without trying the handlers after it.
   */
  async authenticate(scheme: AuthorizationScheme, value: string): Promise<AuthenticationSession> {
    for (const handler of this.handlers) {
      const session = await handler.authenticate(scheme, value);

      if (session !== invalidAuthenticationSession) {
        return session;
      }
    }

    return invalidAuthenticationSession;
  }
}
