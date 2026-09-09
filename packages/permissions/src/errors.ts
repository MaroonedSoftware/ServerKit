/**
 * Why a permissions operation failed. Callers branch on this rather than on
 * message text.
 *
 * - `unknown_namespace` — the model has no namespace by that name.
 * - `unknown_relation` — the namespace has no relation or permission by that name.
 * - `subject_not_allowed` — a tuple names a subject type the relation does not declare.
 */
export type PermissionsErrorCode = 'unknown_namespace' | 'unknown_relation' | 'subject_not_allowed';

/**
 * Error raised by the authorization model and the model-validating repository.
 *
 * These are programmer errors, not access denials: a typo in a permission name
 * reaches `check` as a thrown `PermissionsError`, never as `false`. Catching it
 * and returning a 403 would turn a bug into a silent lockout, so let it surface
 * as a 500 unless you have a specific reason not to.
 *
 * The package deliberately does not extend `ServerkitError` — `permissions` is an
 * L0 package with no internal dependencies, and it must stay that way.
 */
export class PermissionsError extends Error {
  /** Machine-readable reason. */
  readonly code: PermissionsErrorCode;
  /** Namespace the failure relates to, when one is known. */
  readonly namespace?: string;
  /** Relation or permission name the failure relates to, when one is known. */
  readonly relation?: string;

  constructor(code: PermissionsErrorCode, message: string, context: { namespace?: string; relation?: string } = {}) {
    super(message);
    this.name = 'PermissionsError';
    this.code = code;
    this.namespace = context.namespace;
    this.relation = context.relation;
    // `Error` breaks the prototype chain when the class is down-levelled, and this
    // package ships to consumers whose build target we do not control.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Type guard for {@link PermissionsError}. */
export const IsPermissionsError = (error: unknown): error is PermissionsError => error instanceof PermissionsError;
