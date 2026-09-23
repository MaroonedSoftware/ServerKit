import { Injectable } from 'injectkit';
import type { DateTime } from 'luxon';

/**
 * A user's standing permission for one client to act on one resource: what a
 * "connected apps" list shows and what revoking an app removes.
 */
export interface OAuthGrant {
  id: string;
  clientId: string;
  subject: string;
  resource: string;
  scope: string[];
  createdAt: DateTime;
  lastUsedAt?: DateTime;
  /** Set when the user revoked it. A revoked grant refuses every refresh. */
  revokedAt?: DateTime;
}

/** What {@link OAuthGrantRepository.upsert} records. */
export interface OAuthGrantInput {
  clientId: string;
  subject: string;
  resource: string;
  scope: string[];
}

/**
 * Where the authorization server records grants. Optional: without one the
 * server issues tokens and nothing tracks them beyond their sessions.
 *
 * Revocation is the consumer's, because it must also delete the grant's
 * sessions (those whose `claims.oauth.grantId` names it); the token endpoint
 * refuses to refresh a session whose grant is revoked or gone.
 *
 * Register the concrete class under this abstract one, which doubles as the DI
 * token.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface OAuthGrantRepository {
  /**
   * Record a grant, answering it with its id. One grant per `(clientId,
   * subject, resource)`: a repeat consent updates the scope and clears
   * `revokedAt`, since consenting again is granting again.
   */
  upsert(grant: OAuthGrantInput): Promise<OAuthGrant>;
  /** The grant with this id, revoked or not, or `undefined`. */
  find(id: string): Promise<OAuthGrant | undefined>;
  /** Record that a token was issued under the grant. */
  recordUse(id: string, at: DateTime): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class OAuthGrantRepository implements OAuthGrantRepository {}
