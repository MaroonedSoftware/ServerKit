import { describe, expect, it } from 'vitest';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';
import type { AuditEventCategory } from '../../src/audit/types.js';

/**
 * Categorise every event type, with a `never` default.
 *
 * The point is the compiler, not the assertions: adding an event to
 * `AuthenticationAuditEvent` without adding it here fails to build, so a new
 * event cannot be shipped without someone deciding which category it belongs to.
 */
const categoryFor = (type: AuthenticationAuditEvent['type']): AuditEventCategory => {
  switch (type) {
    case 'session.created':
    case 'session.refreshed':
    case 'session.revoked':
    case 'session.revoked_all':
    case 'session.family_revoked':
      return 'session';
    case 'session.updated':
    case 'session.rotated':
      return 'privilege';
    case 'session.validation_failed':
    case 'session.refresh_reuse_detected':
      return 'login';

    case 'api_key.created':
    case 'api_key.updated':
    case 'api_key.rotated':
    case 'api_key.revoked':
    case 'api_key.revoked_all':
    case 'api_key.deleted':
      return 'credential';
    case 'api_key.authenticated':
    case 'api_key.rejected':
      return 'machine';

    case 'password.verify.succeeded':
    case 'password.verify.failed':
    case 'password.verify.rate_limited':
      return 'login';
    case 'password.created':
    case 'password.updated':
    case 'password.changed':
    case 'password.deleted':
      return 'credential';
    case 'password.rate_limit_cleared':
      return 'privilege';

    case 'mfa.completed':
    case 'mfa.failed':
      return 'login';
    case 'mfa.challenge.issued':
    case 'mfa.challenge.skipped':
    case 'mfa.factor_challenge.issued':
    case 'mfa.factor_challenge.ineligible':
      return 'privilege';

    case 'email.challenge.issued':
    case 'email.challenge.verified':
    case 'email.challenge.failed':
    case 'email.challenge.locked':
    case 'phone.challenge.issued':
    case 'phone.challenge.verified':
    case 'phone.challenge.failed':
    case 'phone.challenge.locked':
    case 'authenticator.validated':
    case 'authenticator.validation.failed':
    case 'authenticator.validation.rate_limited':
    case 'authenticator.validation.replayed':
      return 'login';
    case 'email.factor.created':
    case 'email.factor.deleted':
    case 'phone.factor.created':
    case 'phone.factor.deleted':
    case 'authenticator.registered':
      return 'credential';
    case 'authenticator.enrolled':
    case 'authenticator.factor.deleted':
      return 'privilege';

    case 'fido.challenge.issued':
    case 'fido.verified':
    case 'fido.verification.failed':
    case 'oidc.authorization.begun':
    case 'oidc.signed_in':
    case 'oidc.new_user':
    case 'oidc.authorization.failed':
    case 'oauth2.authorization.begun':
    case 'oauth2.signed_in':
    case 'oauth2.new_user':
    case 'oauth2.authorization.failed':
      return 'login';
    case 'fido.registered':
    case 'oidc.factor.created':
    case 'oauth2.factor.created':
      return 'credential';
    case 'fido.enrolled':
    case 'fido.factor.deleted':
    case 'oidc.linked.explicit':
    case 'oidc.linked.auto':
    case 'oidc.link.rejected':
    case 'oidc.factor.deleted':
    case 'oauth2.linked.explicit':
    case 'oauth2.linked.auto':
    case 'oauth2.factor.deleted':
      return 'privilege';

    case 'recovery.initiated':
    case 'recovery.policy_denied':
    case 'recovery.channel.issued':
    case 'recovery.channel.rejected':
      return 'recovery';
    case 'recovery.channel.verified':
    case 'recovery.sessions_revoked':
    case 'recovery.sessions_not_revoked':
      return 'privilege';
    case 'recovery.completed':
      return 'credential';

    default: {
      const unhandled: never = type;
      throw new Error(`unhandled audit event type: ${String(unhandled)}`);
    }
  }
};

describe('the audit event union', () => {
  it('categorises every type, enforced by the compiler', () => {
    expect(categoryFor('password.verify.failed')).toBe('login');
    expect(categoryFor('recovery.completed')).toBe('credential');
    expect(categoryFor('api_key.authenticated')).toBe('machine');
  });

  it('names every type as a dotted identifier with no hyphens', () => {
    const types: AuthenticationAuditEvent['type'][] = [
      'session.created',
      'api_key.rejected',
      'password.verify.rate_limited',
      'mfa.factor_challenge.ineligible',
      'recovery.channel.verified',
    ];

    for (const type of types) {
      expect(type).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
  });
});
