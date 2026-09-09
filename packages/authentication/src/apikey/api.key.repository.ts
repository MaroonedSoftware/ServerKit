import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import type { TargetActor } from '../mfa/types.js';
import type { ApiKey, ApiKeyUpdate } from './types.js';

/** Options for {@link ApiKeyRepository.listByOwner}. */
export interface ApiKeyListOptions {
  /** Include revoked and expired keys. Defaults to `false`. */
  includeInactive?: boolean;
}

/**
 * Fields {@link ApiKeyRepository.update} may write. Extends the public
 * {@link ApiKeyUpdate} with the two the service sets during a rotation, which
 * no caller should be able to set directly.
 */
export type ApiKeyUpdatePatch = ApiKeyUpdate & {
  /** New token hash, written by a rotation. */
  secretHash?: string;
  /** New display hint, written by a rotation alongside `secretHash`. */
  hint?: string;
};

/**
 * Persistence contract for {@link ApiKey} records.
 *
 * Implement against your datastore and register the concrete class under this
 * abstract one, which doubles as the DI token.
 *
 * Two storage requirements the service depends on:
 *
 * - **`secretHash` needs a unique index.** It is the lookup key on the
 *   authentication hot path, so {@link findBySecretHash} must be an indexed read,
 *   and a duplicate hash would mean two keys share a token.
 * - **`revoke` archives, `delete` destroys.** Revoking keeps the row so a key
 *   list can show what was withdrawn and when, and so an audit trail survives.
 *   {@link delete} is the administrative hard-delete.
 */
export interface ApiKeyRepository<K extends string = string> {
  /** Persist a newly issued key. */
  create(key: ApiKey<K>): Promise<ApiKey<K>>;
  /** Retrieve a key by id, or `undefined` when none exists. */
  findById(id: string): Promise<ApiKey<K> | undefined>;
  /**
   * Retrieve a key by its token hash, or `undefined` when none matches.
   *
   * The authentication hot path: one indexed read per request. Return revoked
   * and expired keys as well — the service distinguishes those from `unknown`
   * so it can log a withdrawn key being presented.
   */
  findBySecretHash(secretHash: string): Promise<ApiKey<K> | undefined>;
  /** List an owner's keys, active only unless `includeInactive` is set. */
  listByOwner(owner: TargetActor<K>, options?: ApiKeyListOptions): Promise<ApiKey<K>[]>;
  /** Apply a patch and return the updated key. */
  update(id: string, patch: ApiKeyUpdatePatch): Promise<ApiKey<K>>;
  /** Mark a key revoked at the given time. Already-revoked keys keep their original timestamp. */
  revoke(id: string, at: DateTime): Promise<ApiKey<K>>;
  /**
   * Revoke every active key an owner holds.
   *
   * The seam an application calls when it blocks or deletes an actor. Returns
   * how many keys were revoked, so the caller can log it.
   */
  revokeAllForOwner(owner: TargetActor<K>, at: DateTime): Promise<number>;
  /** Record a successful validation. Called at most once per throttle window. */
  touchLastUsed(id: string, at: DateTime): Promise<void>;
  /** Permanently remove a key. No-op when the id is unknown. */
  delete(id: string): Promise<void>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class ApiKeyRepository<K extends string = string> implements ApiKeyRepository<K> {}
