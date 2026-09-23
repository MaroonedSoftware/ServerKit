import type { OAuthErrorCode } from '../oauth/oauth.types.js';
import type { AuditEvent } from './types.js';

/**
 * OAuth authorization server events.
 *
 * `oauth.client.registered` fires for every Dynamic Client Registration. Claude
 * registers one per connection, so a steady trickle is normal; a burst from one
 * source is not.
 *
 * `oauth.token.rejected` with `invalid_grant` on a refresh is the one to watch:
 * a refresh token presented by a client it was not issued to is spent by the
 * attempt, and the legitimate client's next refresh then trips
 * `session.refresh_reuse_detected`.
 */
export type OAuthAuditEvent =
  | AuditEvent<'oauth.client.registered', { clientId: string; clientName?: string; redirectUris: string[] }>
  /** A user let a client act for them on a resource. */
  | AuditEvent<'oauth.authorization.approved', { clientId: string; resource: string; scope: string[] }>
  /** A user declined. A decision, not a credential failure, so `outcome` is `success`. */
  | AuditEvent<'oauth.authorization.denied', { clientId: string; resource: string }>
  | AuditEvent<'oauth.token.issued', { clientId: string; resource: string; sessionToken: string; grantId?: string }>
  | AuditEvent<'oauth.token.refreshed', { clientId: string; resource: string; grantId?: string }>
  | AuditEvent<'oauth.token.rejected', { reason: OAuthErrorCode; grantType?: string; clientId?: string }>;
