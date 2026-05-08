import { Injectable } from 'injectkit';
import { Policy, PolicyResult, PolicyEnvelope } from '@maroonedsoftware/policies';
import { binarySearch, isEmail } from '@maroonedsoftware/utilities';

/**
 * Context for {@link EmailAllowedPolicy}. The caller is expected to pre-normalise
 * `value` (trim + lowercase) — the policy does not touch the input itself.
 */
export interface EmailAllowedPolicyContext {
  /** Email address to evaluate. */
  value: string;
}

/**
 * Configuration for {@link EmailAllowedPolicy}. Inject via your DI container.
 */
@Injectable()
export class EmailAllowedPolicyOptions {
  constructor(
    /** Domains to reject during email registration (e.g. disposable email providers). Checked via binary search — keep sorted. */
    public readonly emailDomainDenyList: string[] = [],
  ) {}
}

/**
 * Policy that rejects malformed email addresses and addresses whose domain
 * appears in {@link EmailAllowedPolicyOptions.emailDomainDenyList}. Register
 * under the policy name `'email_allowed'` so the bundled `EmailFactorService`
 * can resolve it.
 *
 * Denial reasons:
 * - `'invalid_format'` — `value` is not a syntactically valid email
 * - `'deny_list'` — the domain appears in the configured deny list
 *
 * Subclass to add stricter rules (MX checks, regional filters, dynamic deny
 * lists, …) without touching the factor services.
 */
@Injectable()
export class EmailAllowedPolicy extends Policy<EmailAllowedPolicyContext> {
  constructor(private readonly options: EmailAllowedPolicyOptions) {
    super();
  }

  /**
   * Evaluate the email against the configured rules.
   *
   * @returns An allow result, or a deny result with `reason` of
   *   `'invalid_format'` or `'deny_list'`.
   */
  async evaluate(context: EmailAllowedPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    if (!isEmail(context.value)) {
      return this.deny('invalid_format');
    }

    const domain = context.value.split('@')[1]!;

    if (binarySearch(this.options.emailDomainDenyList, domain)) {
      return this.deny('deny_list');
    }

    return this.allow();
  }
}
