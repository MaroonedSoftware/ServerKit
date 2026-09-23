import { Injectable } from 'injectkit';
import type { DateTime } from 'luxon';
import type { OAuthClient } from './oauth.types.js';

/**
 * Where the authorization server keeps its `preregistered` and `dynamic`
 * clients. Implemented by the consuming app; `metadata_document` clients are
 * never stored.
 *
 * Register the concrete class under this abstract one, which doubles as the DI
 * token.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface OAuthClientRepository {
  /** The client with this `client_id`, or `undefined`. Expired clients may be returned; the resolver refuses them. */
  findByClientId(clientId: string): Promise<OAuthClient | undefined>;
  /** Persist a new client. `clientId` is unique; the package generates it for dynamic clients. */
  create(client: OAuthClient): Promise<OAuthClient>;
  /**
   * Record that a client was just used. `extendTo`, when given, is the client's
   * new `expiresAt`: a dynamic client lives a fixed span after its last use.
   */
  touchLastUsed(clientId: string, at: DateTime, extendTo?: DateTime): Promise<void>;
  /**
   * Delete every client whose `expiresAt` is before `before`, answering how many
   * went. Nothing in the package calls it: schedule it, or dynamic clients
   * accumulate one per connection.
   */
  deleteExpired(before: DateTime): Promise<number>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class OAuthClientRepository implements OAuthClientRepository {}
