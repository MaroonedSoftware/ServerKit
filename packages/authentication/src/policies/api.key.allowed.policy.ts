import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { TargetActor } from '../mfa/types.js';
import type { ApiKey } from '../apikey/types.js';

/**
 * Context for {@link ApiKeyAllowedPolicy}. Supplied by
 * {@link import('../apikey/api.key.service.js').ApiKeyService} at every create
 * and every validate, so the policy can gate the API key surface globally
 * (a kill switch, a plan gate) or per actor.
 *
 * `operation: 'validate'` runs on the authentication hot path, once per
 * request. Keep overrides cheap, and cache anything that needs I/O.
 */
export interface ApiKeyAllowedPolicyContext<K extends string = string> {
  /** The actor the key belongs to, or is being issued to. */
  owner: TargetActor<K>;
  /** Which side of the lifecycle is being evaluated. */
  operation: 'create' | 'validate';
  /** The key itself. Absent on `'create'`, since it does not exist yet. */
  key?: ApiKey<K>;
}

/**
 * Default rule for deciding whether the API key surface is available.
 *
 * Allows everything. Issuing and presenting a key are ordinary operations by
 * default, and the interesting rules are application-specific: keys only on
 * paid plans, only for confirmed accounts, not for a suspended organisation.
 *
 * Subclass and re-register under `'auth.api.key.allowed'` to add those. A deny
 * on `'validate'` surfaces as
 * {@link import('../apikey/types.js').ApiKeyRejectionReason} `'policy_denied'`,
 * which the handler turns into `invalidAuthenticationSession` rather than an
 * error — the caller learns the credential did not work, not why.
 */
@Injectable()
export class ApiKeyAllowedPolicy extends Policy<ApiKeyAllowedPolicyContext> {
  async evaluate(_context: ApiKeyAllowedPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    return this.allow();
  }
}
