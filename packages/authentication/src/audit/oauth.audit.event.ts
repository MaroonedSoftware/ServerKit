import type { AuditEvent } from './types.js';

/**
 * OAuth authorization server events.
 *
 * `oauth.client.registered` fires for every Dynamic Client Registration. Claude
 * registers one per connection, so a steady trickle is normal; a burst from one
 * source is not.
 */
export type OAuthAuditEvent = AuditEvent<'oauth.client.registered', { clientId: string; clientName?: string; redirectUris: string[] }>;
