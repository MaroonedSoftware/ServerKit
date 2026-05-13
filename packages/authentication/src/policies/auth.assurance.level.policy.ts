import { Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { AuthenticationFactorKind, AuthenticationSessionFactor } from '../types.js';
import { isFactorRecent } from '../helpers.js';

/** Default freshness window when `within` is omitted (15 minutes — matches common step-up windows). */
const DEFAULT_ASSURANCE_WINDOW = Duration.fromObject({ minutes: 15 });

/** Acceptable assurance levels modeled on NIST 800-63B AAL terminology. */
export type AuthAssuranceLevel = 'aal1' | 'aal2';

/**
 * Context for {@link DefaultAssuranceLevelPolicy}. The caller supplies the
 * session's `factors` snapshot and the assurance level they require; the
 * policy checks whether the session's recent factors satisfy it.
 */
export interface AuthAssuranceLevelPolicyContext {
  /** Authentication factors on the current session, evaluated for recency and assurance. */
  factors: ReadonlyArray<AuthenticationSessionFactor>;
  /** Required assurance level. */
  minLevel: AuthAssuranceLevel;
  /** Maximum age of an acceptable factor re-verification. Defaults to 15 minutes. */
  within?: Duration;
}

/**
 * NIST 800-63B-style assurance-level rule.
 *
 * - **AAL1** — any single factor verified within `within` of `envelope.now`.
 * - **AAL2** — satisfied when either:
 *   - the session has at least one `knowledge` factor *and* at least one
 *     non-knowledge (`possession` or `biometric`) factor — the classic
 *     "something you know + something you have/are" combo, OR
 *   - the session has zero `knowledge` factors *and* at least two distinct
 *     non-knowledge factors — passwordless paths where two independent
 *     possession/biometric proofs substitute for a knowledge factor.
 *
 * Distinctness for the passwordless path is by `(method, methodId)` so two
 * proofs from the same hardware key or the same authenticator app don't
 * double-count.
 *
 * On deny, embeds a step-up requirement so clients can drive the user
 * through whichever re-auth challenge would actually move the session to the
 * target AAL — if a knowledge factor is already on file, only a
 * possession/biometric factor will help; otherwise either a knowledge factor
 * or a second distinct non-knowledge factor works.
 *
 * The policy takes no opinion on the actor model — callers extract `factors`
 * from their actor or session shape before invoking. Subclass and re-register
 * under the same `'auth.session.assurance.level'` name to layer additional rules.
 */
@Injectable()
export class DefaultAssuranceLevelPolicy extends Policy<AuthAssuranceLevelPolicyContext> {
  async evaluate(context: AuthAssuranceLevelPolicyContext, envelope: PolicyEnvelope): Promise<PolicyResult> {
    const within = context.within ?? DEFAULT_ASSURANCE_WINDOW;
    const fresh = context.factors.filter(factor => isFactorRecent(factor, envelope.now, within));

    if (context.minLevel === 'aal1') {
      if (fresh.length >= 1) return this.allow();
      return this.denyStepUp('current session does not meet aal1', {
        within,
        acceptableKinds: ['knowledge', 'possession', 'biometric'] satisfies ReadonlyArray<AuthenticationFactorKind>,
      }).withHeaders({ 'WWW-Authenticate': 'Bearer error="aal1_required"' });
    }

    const knowledgeCount = fresh.filter(factor => factor.kind === 'knowledge').length;
    const nonKnowledge = fresh.filter(factor => factor.kind === 'possession' || factor.kind === 'biometric');
    const distinctNonKnowledge = new Set(nonKnowledge.map(factor => `${factor.method}:${factor.methodId}`)).size;

    const knowledgePlusOther = knowledgeCount >= 1 && nonKnowledge.length >= 1;
    const passwordlessPair = knowledgeCount === 0 && distinctNonKnowledge >= 2;
    if (knowledgePlusOther || passwordlessPair) return this.allow();

    // Tell the client which factor kinds would actually move the session to AAL2.
    const acceptableKinds: ReadonlyArray<AuthenticationFactorKind> =
      knowledgeCount >= 1 ? ['possession', 'biometric'] : ['knowledge', 'possession', 'biometric'];

    return this.denyStepUp('current session does not meet aal2', { within, acceptableKinds }).withHeaders({
      'WWW-Authenticate': 'Bearer error="aal2_required"',
    });
  }
}
