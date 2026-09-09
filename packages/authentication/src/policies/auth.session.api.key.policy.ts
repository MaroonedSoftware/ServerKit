import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { AuthenticationSession } from '../types.js';
import type { ApiKeySessionClaim } from '../apikey/types.js';

/**
 * Policy name under which {@link ApiKeySessionPolicy} is registered.
 *
 * Reference it rather than spelling the literal, so a route and its policy
 * cannot drift apart.
 */
export const API_KEY_SESSION_POLICY = 'auth.session.api.key' as const;

/** Scope value that satisfies every scope check. */
export const API_KEY_WILDCARD_SCOPE = '*';

/**
 * Read the API key claim off a session, if it has one.
 *
 * The presence of this claim is how a policy or a route tells a machine caller
 * from a person. Exported because applications need the same test —
 * "is this an integration?" — in their own rules.
 *
 * @param session - The session to inspect.
 * @returns The claim, or `undefined` when the session was not established by an API key.
 */
export const getApiKeyClaim = <K extends string = string>(session: AuthenticationSession): ApiKeySessionClaim<K> | undefined => {
  const claim = session.claims['apiKey'];
  return typeof claim === 'object' && claim !== null ? (claim as ApiKeySessionClaim<K>) : undefined;
};

/** Context for {@link ApiKeySessionPolicy}. */
export interface ApiKeySessionPolicyContext {
  /** The session to evaluate. */
  session: AuthenticationSession;
  /**
   * Scope the route requires. Omit to accept any API key session.
   *
   * A key satisfies it by listing the scope, or by holding
   * {@link API_KEY_WILDCARD_SCOPE}.
   */
  scope?: string;
}

/**
 * Gate a route on being reached by an API key, optionally with a scope.
 *
 * The counterpart to the default MFA gate: `requirePolicy()` rejects a key
 * session because it carries one factor, so a machine route names this policy
 * instead.
 *
 * ```ts
 * router.post('/v1/deploys', requirePolicy({ policy: API_KEY_SESSION_POLICY }), handler);
 * ```
 *
 * Scope enforcement lives here rather than in `ApiKeyService` on purpose: what a
 * scope permits is a property of the route, and the service has no idea which
 * route a key is being presented to.
 *
 * On an insufficient scope this denies with
 * `WWW-Authenticate: Bearer error="insufficient_scope"`, per RFC 6750 §3.1, so a
 * client can tell "your key is wrong" from "your key lacks this permission".
 */
@Injectable()
export class ApiKeySessionPolicy extends Policy<ApiKeySessionPolicyContext> {
  async evaluate(context: ApiKeySessionPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    const claim = getApiKeyClaim(context.session);

    if (!claim) {
      return this.deny('api_key_required').withHeaders({ 'WWW-Authenticate': 'Bearer error="invalid_token"' });
    }

    const { scope } = context;
    if (scope === undefined) return this.allow();

    const scopes = claim.scopes;
    if (scopes.includes(scope) || scopes.includes(API_KEY_WILDCARD_SCOPE)) return this.allow();

    return this.deny('insufficient_scope').withHeaders({ 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scope}"` });
  }
}
