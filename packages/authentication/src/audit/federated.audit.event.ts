import type { AuditEvent } from './types.js';

/** Why {@link FidoAuditEvent} `'fido.verification.failed'` was recorded. */
export type FidoFailureReason =
  /** The challenge expired, was already redeemed, or never existed. */
  | 'challenge_not_found'
  /** No active factor matches the presented credential id. */
  | 'no_active_factor'
  /** The credential is not the one this challenge was issued against. */
  | 'credential_not_bound'
  /**
   * The stored factor has no replay counter.
   *
   * A data-integrity alarm, not a user error: without a counter the library
   * accepts any value, so replay protection is silently off for that credential.
   */
  | 'missing_counter'
  /** The authenticator's signature did not verify. */
  | 'invalid_assertion';

/** FIDO2 / WebAuthn factor events. */
export type FidoAuditEvent =
  | AuditEvent<'fido.registered', { label?: string }>
  /** A credential was confirmed and is now a live factor. `privilege`: it raises reachable assurance. */
  | AuditEvent<'fido.enrolled', { factorId: string; label?: string }>
  | AuditEvent<'fido.challenge.issued', { factorId: string }>
  | AuditEvent<'fido.verified', { factorId: string }>
  | AuditEvent<'fido.verification.failed', { factorId?: string; reason: FidoFailureReason }>
  | AuditEvent<'fido.factor.deleted', { factorId: string }>;

/** The identity provider and subject an event concerns. */
export interface AuditFederatedIdentity {
  /** Provider key as configured in the provider registry. */
  provider: string;
  /** The provider's stable subject identifier for the user. */
  subject?: string;
}

/** Why a federated authorization was refused. */
export type FederatedFailureReason =
  /** The identity provider returned an error instead of a code. */
  | 'provider_error'
  /** The callback carried no `state`, or one the package never issued. */
  | 'state_invalid'
  /**
   * The `iss` returned did not match the provider the state was issued for.
   *
   * RFC 9207 mix-up detection. An attacker splicing one provider's response onto
   * another provider's flow, not a configuration slip.
   */
  | 'issuer_mismatch'
  /** The profile-allowed policy refused the identity. */
  | 'policy_denied';

/**
 * OpenID Connect and OAuth 2.0 factor events.
 *
 * `linked.auto` is the one to watch. The package links a provider identity to a
 * pre-existing local account purely on a verified email match, which is the
 * account-takeover-adjacent path: anyone who can get an identity provider to
 * assert a verified address gains that account. It is recorded with the provider,
 * the subject, and the actor it matched so the join can be reviewed after the
 * fact.
 */
export type FederatedAuditEvent =
  | AuditEvent<'oidc.authorization.begun', AuditFederatedIdentity>
  | AuditEvent<'oidc.signed_in', AuditFederatedIdentity & { factorId: string }>
  /** The user explicitly linked a provider to the account they were signed in to. */
  | AuditEvent<'oidc.linked.explicit', AuditFederatedIdentity & { actorId: string }>
  /** The package linked a provider identity to an existing account on a verified email match. */
  | AuditEvent<'oidc.linked.auto', AuditFederatedIdentity & { email?: string }>
  /** A link was declined because the provider did not assert the email as verified. */
  | AuditEvent<'oidc.link.rejected', AuditFederatedIdentity & { reason: 'unverified_email' }>
  | AuditEvent<'oidc.new_user', AuditFederatedIdentity>
  | AuditEvent<'oidc.authorization.failed', AuditFederatedIdentity & { reason: FederatedFailureReason }>
  | AuditEvent<'oidc.factor.created', AuditFederatedIdentity & { factorId: string }>
  | AuditEvent<'oidc.factor.deleted', { factorId: string }>
  | AuditEvent<'oauth2.authorization.begun', AuditFederatedIdentity>
  | AuditEvent<'oauth2.signed_in', AuditFederatedIdentity & { factorId: string }>
  | AuditEvent<'oauth2.linked.explicit', AuditFederatedIdentity & { actorId: string }>
  | AuditEvent<'oauth2.linked.auto', AuditFederatedIdentity & { email?: string }>
  | AuditEvent<'oauth2.new_user', AuditFederatedIdentity>
  | AuditEvent<'oauth2.authorization.failed', AuditFederatedIdentity & { reason: FederatedFailureReason }>
  | AuditEvent<'oauth2.factor.created', AuditFederatedIdentity & { factorId: string }>
  | AuditEvent<'oauth2.factor.deleted', { factorId: string }>;
