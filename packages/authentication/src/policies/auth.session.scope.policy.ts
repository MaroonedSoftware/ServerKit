import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { AuthenticationSession } from '../types.js';
import { getOAuthSessionClaim } from '../oauth/oauth.session.claim.js';
import { API_KEY_WILDCARD_SCOPE, getApiKeyClaim } from './auth.session.api.key.policy.js';

/**
 * Policy name under which {@link SessionScopePolicy} is registered.
 *
 * Reference it rather than spelling the literal, so a route and its policy
 * cannot drift apart.
 */
export const SESSION_SCOPE_POLICY = 'auth.session.scope' as const;

/**
 * The scopes a session was delegated, or `undefined` when nothing narrowed it.
 *
 * An OAuth client's session carries the scopes consented to (`claims.oauth.scope`);
 * an API key's session carries the key's (`claims.apiKey.scopes`). A person's own
 * session carries neither: it was not delegated, so no scope limits it.
 *
 * @param session - The session to inspect.
 * @returns The delegated scopes, or `undefined` for an undelegated session.
 */
export const getSessionScopes = (session: AuthenticationSession): readonly string[] | undefined =>
  getOAuthSessionClaim(session)?.scope ?? getApiKeyClaim(session)?.scopes;

/** Context for {@link SessionScopePolicy}. */
export interface SessionScopePolicyContext {
  /** The session to evaluate. */
  session: AuthenticationSession;
  /** The scope the route or operation requires. */
  scope: string;
}

/**
 * Require a scope of a delegated session: an OAuth client's or an API key's.
 *
 * {@link import('./auth.session.api.key.policy.js').ApiKeySessionPolicy} checks a
 * key's scopes, but only accepts key sessions, and nothing checked the scopes an
 * OAuth grant was consented to. This policy checks either, so one rule covers
 * every credential a person hands to an integration.
 *
 * A session that neither carries is the person's own and is allowed: scopes
 * narrow what a delegate may do, they never grant. What the person may do is
 * still decided by the route's authentication and authorization, so pair this
 * with them rather than using it alone.
 *
 * An API key holding {@link API_KEY_WILDCARD_SCOPE} satisfies any scope. An OAuth
 * grant has no wildcard: it holds what was consented to.
 *
 * ```ts
 * await policies.assert(SESSION_SCOPE_POLICY, { session, scope: 'write' });
 * ```
 *
 * On an insufficient scope this denies with
 * `WWW-Authenticate: Bearer error="insufficient_scope"`, per RFC 6750 §3.1.
 */
@Injectable()
export class SessionScopePolicy extends Policy<SessionScopePolicyContext> {
  async evaluate(context: SessionScopePolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    const { session, scope } = context;

    const oauth = getOAuthSessionClaim(session);
    if (oauth) {
      if (oauth.scope.includes(scope)) return this.allow();
      return this.insufficient(scope);
    }

    const apiKey = getApiKeyClaim(session);
    if (apiKey) {
      if (apiKey.scopes.includes(scope) || apiKey.scopes.includes(API_KEY_WILDCARD_SCOPE)) return this.allow();
      return this.insufficient(scope);
    }

    return this.allow();
  }

  private insufficient(scope: string): PolicyResult {
    return this.deny('insufficient_scope').withHeaders({ 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scope}"` });
  }
}
