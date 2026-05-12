import { Injectable } from 'injectkit';
import { Policy, PolicyResult, PolicyEnvelope } from '@maroonedsoftware/policies';
import { PasswordStrengthProvider } from '../providers/password.strength.provider.js';
import { PasswordHashProvider } from '../providers/password.hash.provider.js';

/**
 * Context for {@link PasswordAllowedPolicy}.
 *
 * `previousPasswords` is opt-in: omit it on flows where reuse evaluation does
 * not apply (e.g. initial registration, password resets). Supply the actor's
 * recent hashes — typically the result of
 * `PasswordFactorRepository.listPreviousPasswords(actorId, n)` — to enable the
 * reuse check.
 */
export interface PasswordAllowedPolicyContext {
  /** Plaintext password to evaluate. */
  password: string;
  /** Optional history of prior password hashes to check for reuse. */
  previousPasswords?: ReadonlyArray<{ hash: string; salt: string }>;
}

/**
 * Policy that rejects passwords failing the configured strength threshold or
 * matching one of the actor's previous hashes. Register under the policy name
 * `'auth.factor.password.allowed'` so the bundled `PasswordFactorService` can resolve it.
 *
 * Denial reasons:
 * - `'weak_password'` — strength provider reports the password as unacceptable.
 *   `details` carries `{ warning, suggestions }` from the strength provider so
 *   callers can surface remediation hints.
 * - `'reused_password'` — `previousPasswords` was supplied and one of its
 *   entries verifies against the candidate password.
 *
 * Subclass to layer in additional rules (deny-listed substrings, breach checks
 * beyond what the strength provider already covers, regional policies) without
 * touching the factor service.
 */
@Injectable()
export class PasswordAllowedPolicy extends Policy<PasswordAllowedPolicyContext> {
  constructor(
    private readonly passwordStrengthProvider: PasswordStrengthProvider,
    private readonly passwordHashProvider: PasswordHashProvider,
  ) {
    super();
  }

  /**
   * Evaluate the candidate password.
   *
   * @returns An allow result, or a deny result with `reason` of
   *   `'weak_password'` (with `{ warning, suggestions }` details) or
   *   `'reused_password'`.
   */
  async evaluate(context: PasswordAllowedPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    const strength = await this.passwordStrengthProvider.checkStrength(context.password);
    if (!strength.valid) {
      return this.deny('weak_password', {
        warning: strength.feedback.warning,
        suggestions: strength.feedback.suggestions,
      });
    }

    if (context.previousPasswords?.length) {
      for (const previous of context.previousPasswords) {
        if (await this.passwordHashProvider.verify(context.password, previous.hash, previous.salt)) {
          return this.deny('reused_password');
        }
      }
    }

    return this.allow();
  }
}
