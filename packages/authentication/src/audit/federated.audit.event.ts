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
/**
 * Why an OIDC link was declined.
 *
 * - `unverified_email`: the identity's email matches an existing account, but the
 *   provider did not assert it as verified, so it was not auto-linked.
 * - `subject_taken`: an explicit link was attempted for a `(provider, subject)`
 *   that already belongs to a different account. Repeated occurrences for one
 *   subject are worth a look: someone is trying to attach an identity they control
 *   to more than one account, or to take one over.
 */
export type FederatedLinkRejectedReason = 'unverified_email' | 'subject_taken';

/**
 * Which rule decided whether an identity's email could join an existing account.
 *
 * - `email_verified`: the IdP's `email_verified` claim (the default).
 * - `provider`: the provider's `trustEmail` hook, which replaces `email_verified`
 *   for that provider. An auto-link recorded with `provider` was vouched for by the
 *   app's own rule (for example, the address is in a domain the organization verified),
 *   not by the IdP.
 */
export type FederatedEmailTrust = 'email_verified' | 'provider';

/**
 * Why an OIDC step-up was refused.
 *
 * - `not_linked`: the identity the IdP returned is not a factor of the actor stepping
 *   up. Either the user signed in to the IdP as someone else, or the identity belongs
 *   to another account.
 */
export type FederatedStepUpRejectedReason = 'not_linked';

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
  | 'policy_denied'
  /**
   * SAML: a response that answers no request this service issued: no `InResponseTo`
   * (IdP-initiated), or one that is unknown, expired, or already answered.
   */
  | 'unsolicited'
  /**
   * SAML: the response or assertion failed validation: signature, algorithm, issuer,
   * audience, destination, recipient, validity window, or authentication context.
   */
  | 'assertion_invalid'
  /** SAML: an assertion whose `ID` was already accepted once. */
  | 'assertion_replayed';

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
  /**
   * The package linked a provider identity to an existing account on a trusted email match.
   * `emailTrust` says which rule trusted the address.
   */
  | AuditEvent<'oidc.linked.auto', AuditFederatedIdentity & { email?: string; emailTrust?: FederatedEmailTrust }>
  /**
   * A link was declined: an untrusted email match, or an identity already on another account.
   * For `unverified_email`, `emailTrust` says which rule refused the address.
   */
  | AuditEvent<'oidc.link.rejected', AuditFederatedIdentity & { reason: FederatedLinkRejectedReason; emailTrust?: FederatedEmailTrust }>
  | AuditEvent<'oidc.new_user', AuditFederatedIdentity>
  /** A signed-in actor re-authenticated through a provider identity they own. */
  | AuditEvent<'oidc.stepped_up', AuditFederatedIdentity & { factorId: string }>
  /** A step-up returned an identity that is not a factor of the stepping-up actor. */
  | AuditEvent<'oidc.step_up.rejected', AuditFederatedIdentity & { reason: FederatedStepUpRejectedReason }>
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
  | AuditEvent<'oauth2.factor.deleted', { factorId: string }>
  /** SAML 2.0 counterparts of the `oidc.*` events, recorded by `@maroonedsoftware/saml`. `subject` is the NameID. */
  | AuditEvent<'saml.authorization.begun', AuditFederatedIdentity>
  | AuditEvent<'saml.signed_in', AuditFederatedIdentity & { factorId: string }>
  | AuditEvent<'saml.linked.explicit', AuditFederatedIdentity & { actorId: string }>
  | AuditEvent<'saml.linked.auto', AuditFederatedIdentity & { email?: string; emailTrust?: FederatedEmailTrust }>
  | AuditEvent<'saml.link.rejected', AuditFederatedIdentity & { reason: FederatedLinkRejectedReason; emailTrust?: FederatedEmailTrust }>
  | AuditEvent<'saml.new_user', AuditFederatedIdentity>
  | AuditEvent<'saml.stepped_up', AuditFederatedIdentity & { factorId: string }>
  | AuditEvent<'saml.step_up.rejected', AuditFederatedIdentity & { reason: FederatedStepUpRejectedReason }>
  | AuditEvent<'saml.authorization.failed', AuditFederatedIdentity & { reason: FederatedFailureReason }>
  | AuditEvent<'saml.factor.created', AuditFederatedIdentity & { factorId: string }>
  | AuditEvent<'saml.factor.deleted', { factorId: string }>;
