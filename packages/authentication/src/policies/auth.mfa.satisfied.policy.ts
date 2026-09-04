import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { AuthenticationSession } from '../types.js';

/**
 * Policy name under which {@link DefaultMfaSatisfiedPolicy} is registered, and
 * the default gate for `requirePolicy()` in `@maroonedsoftware/koa` and
 * `@maroonedsoftware/fastify`.
 *
 * Reference it instead of spelling the literal, so code that mirrors the HTTP
 * default — a `@maroonedsoftware/mcp` tool calling `requireMcpPolicy`, say —
 * cannot drift from it.
 */
export const MFA_SATISFIED_POLICY = 'auth.session.mfa.satisfied' as const;

/**
 * Context for {@link DefaultMfaSatisfiedPolicy}: the current authentication
 * session whose factors will be evaluated against the MFA rule.
 */
export interface AuthMfaSatisfiedPolicyContext {
  /** The authentication session to evaluate. */
  session: AuthenticationSession;
}

/**
 * Gate-style rule: does the current session count as MFA-satisfied?
 *
 * Mirrors the historical {@link import('../mfa/mfa.orchestrator.js').MfaOrchestrator}
 * "second factor present" intuition, but answered from the session alone — no
 * primary/secondary/available-factors context needed. Used by
 * `requirePolicy({ policy: MFA_SATISFIED_POLICY })` (and, by default, by
 * `requirePolicy()` with no options) to gate routes that require MFA.
 *
 * The default rule allows when **at least two factors are present** *and* **not
 * every factor is of `kind: 'knowledge'`**. Sessions with a single factor —
 * including OIDC-only sessions (one `possession` factor) — are denied. Apps
 * whose IdP enforces MFA upstream should subclass and re-register under
 * {@link MFA_SATISFIED_POLICY} to relax this rule for `oidc` factors:
 *
 * @example
 * ```ts
 * @Injectable()
 * class OidcAwareMfaSatisfiedPolicy extends Policy<AuthMfaSatisfiedPolicyContext> {
 *   async evaluate({ session }: AuthMfaSatisfiedPolicyContext) {
 *     if (session.factors.some(f => f.method === 'oidc')) return this.allow();
 *     // fall back to default rule
 *     if (session.factors.length >= 2 && !session.factors.every(f => f.kind === 'knowledge')) {
 *       return this.allow();
 *     }
 *     return this.deny('mfa_required').withHeaders({ 'WWW-Authenticate': 'Bearer error="mfa_required"' });
 *   }
 * }
 * ```
 *
 * On deny, attaches `WWW-Authenticate: Bearer error="mfa_required"` so SPAs
 * can detect MFA-required responses the same way they detect 401s.
 */
@Injectable()
export class DefaultMfaSatisfiedPolicy extends Policy<AuthMfaSatisfiedPolicyContext> {
  async evaluate(context: AuthMfaSatisfiedPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    const { factors } = context.session;
    if (factors.length >= 2 && !factors.every(factor => factor.kind === 'knowledge')) {
      return this.allow();
    }
    return this.deny('mfa_required').withHeaders({ 'WWW-Authenticate': 'Bearer error="mfa_required"' });
  }
}
