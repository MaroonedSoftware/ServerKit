import type { AuthenticationSession } from '../types.js';

/**
 * Placed at `session.claims.oauth` on every session the token endpoint mints.
 * Its presence is how a policy or route tells an OAuth client's session from
 * the user's own.
 */
export interface OAuthSessionClaim {
  clientId: string;
  clientName?: string;
  /** The resource the session's tokens are bound to; also the session's `audience`. */
  resource: string;
  scope: string[];
  /** The grant it was issued under, when a grant repository is bound. */
  grantId?: string;
}

/**
 * Read the OAuth claim off a session, if it has one.
 *
 * @returns The claim, or `undefined` when the session was not minted for an OAuth client.
 */
export const getOAuthSessionClaim = (session: AuthenticationSession): OAuthSessionClaim | undefined => {
  const claim = session.claims['oauth'];
  if (typeof claim !== 'object' || claim === null) return undefined;
  const candidate = claim as Record<string, unknown>;
  if (typeof candidate.clientId !== 'string' || typeof candidate.resource !== 'string' || !Array.isArray(candidate.scope)) return undefined;
  return claim as OAuthSessionClaim;
};
