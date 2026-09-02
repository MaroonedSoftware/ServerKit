import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { PolicyService } from '@maroonedsoftware/policies';
import { unauthorizedError } from '@maroonedsoftware/errors';
import { ServerKitRouterMiddleware } from '../../serverkit.middleware.js';

/**
 * Options for {@link requirePolicy}.
 */
export interface RequirePolicyOptions {
  /**
   * Policy name to evaluate against `{ session: request.authenticationSession }`
   * via {@link PolicyService.assert}. The policy is resolved from
   * `request.container` per request, so applications can swap the underlying rule
   * by registering their own policy class against the same name in
   * `PolicyRegistryMap`.
   *
   * Defaults to `'auth.session.mfa.satisfied'`. Pass `false` to validate the
   * session only (skip the policy check entirely).
   */
  policy?: string | false;
}

const DEFAULT_POLICY = 'auth.session.mfa.satisfied' as const;

/**
 * Route guard that enforces a valid authentication session and, by
 * default, the `'auth.session.mfa.satisfied'` policy.
 *
 * Reads `request.authenticationSession` (set by `authenticationMiddleware`) and:
 *
 * - Throws HTTP 401 with `WWW-Authenticate: Bearer error="invalid_token"`
 *   when the session is `invalidAuthenticationSession`.
 * - When `options.policy` is set (or omitted — the default is
 *   `'auth.session.mfa.satisfied'`), resolves the `PolicyService` from
 *   `request.container` and calls `assert(policy, { session })`. The policy
 *   declares its own wire-shape — including any `WWW-Authenticate` header
 *   needed for clients to drive re-auth — via `result.headers`.
 * - When `options.policy` is `false`, skips the policy check (the session
 *   only needs to be valid).
 * - Otherwise lets the request through.
 *
 * @param options - Optional. Defaults to `{ policy: 'auth.session.mfa.satisfied' }`.
 * @returns A {@link ServerKitRouterMiddleware} that guards the route.
 * @throws {HttpError} 401 when the session is invalid.
 * @throws {HttpError} 403 when the policy denies (with `details`, `headers`,
 *   and `internalDetails` populated by the policy).
 *
 * @example
 * ```typescript
 * // Default MFA gate
 * router.get('/profile', requirePolicy(), handler);
 *
 * // AAL2 step-up gate
 * router.post('/admin/dangerous', requirePolicy({ policy: 'auth.session.assurance.level' }), handler);
 *
 * // Authenticated-only (no policy)
 * router.post('/mfa/enroll', requirePolicy({ policy: false }), handler);
 * ```
 */
export const requirePolicy = (options: RequirePolicyOptions = {}): ServerKitRouterMiddleware => {
  const policy = options.policy === undefined ? DEFAULT_POLICY : options.policy;

  return async request => {
    const session = request.authenticationSession;

    if (session === invalidAuthenticationSession) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    if (policy !== false) {
      const policyService = request.container.get(PolicyService);
      await policyService.assert(policy, { session });
    }
  };
};
