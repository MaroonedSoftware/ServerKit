import { Injectable } from 'injectkit';
import { Policy, PolicyResult, PolicyEnvelope } from '@maroonedsoftware/policies';
import { isPhoneE164 } from '@maroonedsoftware/utilities';

/**
 * Context for {@link PhoneAllowedPolicy}.
 */
export interface PhoneAllowedPolicyContext {
  /** Phone number to evaluate, expected in E.164 format (e.g. `+12025550123`). */
  value: string;
}

/**
 * Policy that rejects phone numbers that are not in E.164 format. Register
 * under the policy name `'auth.factor.phone.allowed'` so the bundled `PhoneFactorService`
 * can resolve it.
 *
 * Denial reasons:
 * - `'invalid_format'` — `value` is not a valid E.164 phone number
 *
 * Subclass to add stricter rules (regional filters, deny lists, carrier
 * lookups, …) without touching the factor services.
 */
@Injectable()
export class PhoneAllowedPolicy extends Policy<PhoneAllowedPolicyContext> {
  /**
   * Evaluate the phone number against the configured rules.
   *
   * @returns An allow result, or a deny result with `reason` of `'invalid_format'`.
   */
  async evaluate(context: PhoneAllowedPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    if (!isPhoneE164(context.value)) {
      return this.deny('invalid_format');
    }

    return this.allow();
  }
}
