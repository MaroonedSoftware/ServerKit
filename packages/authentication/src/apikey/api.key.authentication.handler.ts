import { Injectable } from 'injectkit';
import { invalidAuthenticationSession, type AuthenticationSession } from '../types.js';
import type { AuthenticationHandler, AuthorizationScheme } from '../authentication.handler.js';
import { ApiKeyService, ApiKeyServiceOptions } from './api.key.service.js';

/**
 * Resolves a presented API key into an {@link AuthenticationSession}, so machine
 * callers authenticate through the same stack as everything else.
 *
 * Register it under `bearer` via {@link import('../chained.authentication.handler.js').ChainedAuthenticationHandler},
 * since a scheme holds one handler and `Bearer` usually already carries session
 * JWTs. Put this one **first**: its prefix and checksum test costs no I/O, so a
 * JWT falls through to the next handler without a database round trip, while a
 * JWT handler asked about an API key would have to decode it first.
 *
 * ```ts
 * registry.register(ApiKeyAuthenticationHandler).useClass(ApiKeyAuthenticationHandler).asSingleton();
 * registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain)
 *   .push(ApiKeyAuthenticationHandler)
 *   .push(JwtAuthenticationHandler);
 * registry.register(ChainedAuthenticationHandler).useClass(ChainedAuthenticationHandler).asSingleton();
 * registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', ChainedAuthenticationHandler);
 * ```
 *
 * To accept `Authorization: ApiKey sk_…` as well, add `'apikey'` to
 * {@link ApiKeyServiceOptions.schemes} and register this handler directly under
 * that scheme — no chain needed, since nothing else claims it:
 *
 * ```ts
 * registry.register(ApiKeyServiceOptions).useValue(new ApiKeyServiceOptions('sk', 32, undefined, undefined, undefined, ['bearer', 'apikey']));
 * registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap)
 *   .set('bearer', ChainedAuthenticationHandler)
 *   .set('apikey', ApiKeyAuthenticationHandler);
 * ```
 *
 * The session this produces carries one factor, so `requirePolicy()`'s default
 * MFA gate rejects it. Mount machine routes with
 * {@link import('../policies/auth.session.api.key.policy.js').API_KEY_SESSION_POLICY},
 * or {@link import('../policies/auth.session.mfa.satisfied.or.api.key.policy.js').MFA_SATISFIED_OR_API_KEY_POLICY}
 * for a route that serves both people and integrations.
 */
@Injectable()
export class ApiKeyAuthenticationHandler implements AuthenticationHandler {
  constructor(
    private readonly options: ApiKeyServiceOptions,
    private readonly service: ApiKeyService,
  ) {}

  /**
   * Resolve a presented credential.
   *
   * Declines — rather than throws — for anything that is not one of ours, which
   * is the chain contract: a throw would stop the handlers registered behind
   * this one from being tried at all.
   *
   * @param scheme - The authorization scheme, already lowercased by
   *   `AuthenticationSchemeHandler`. Anything outside
   *   {@link ApiKeyServiceOptions.schemes} declines.
   * @param value  - The raw credential, already stripped of its scheme.
   * @returns A session, or `invalidAuthenticationSession` when the scheme is not
   *   ours, the value does not carry our prefix, or the key does not validate.
   */
  async authenticate(scheme: AuthorizationScheme, value: string): Promise<AuthenticationSession> {
    if (!this.options.schemes.includes(scheme)) return invalidAuthenticationSession;

    // Cheapest possible decline, and the reason this handler goes first in a
    // chain: every JWT bearer request reaches it, and none of them should cost
    // a parse or a query.
    if (!value.startsWith(`${this.options.prefix}_`)) return invalidAuthenticationSession;

    return this.service.authenticate(value);
  }
}
