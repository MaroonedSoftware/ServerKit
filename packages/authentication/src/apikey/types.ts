import { DateTime } from 'luxon';
import type { TargetActor } from '../mfa/types.js';

/**
 * A machine credential issued to an actor.
 *
 * The token itself is never stored — only {@link secretHash} (SHA-256 of the
 * whole token) and {@link hint} (its leading characters). A key is therefore
 * unrecoverable once issued; the only remedy for a lost token is
 * {@link import('./api.key.service.js').ApiKeyService.rotate}.
 */
export interface ApiKey<K extends string = string> {
  /** Stable identifier for management operations. Not part of the token. */
  id: string;
  /**
   * Who the key acts as. A personal key is `{ kind: 'user', actorId }`; an
   * org-scoped key carries `organizationId`; a service key uses whatever
   * `kind` the application defines.
   */
  owner: TargetActor<K>;
  /** Human-readable label chosen by whoever created the key. */
  name: string;
  /** Optional class segment embedded in the token, e.g. `'live'` or `'test'`. */
  type?: string;
  /** Leading characters of the token, safe to display in a key list. */
  hint: string;
  /** SHA-256 of the complete token, lowercase hex. The lookup key. */
  secretHash: string;
  /** Scopes this key carries. Enforced by `'auth.session.api.key'`, not here. */
  scopes: string[];
  /** Application-defined data returned on every successful validation. */
  metadata: Record<string, unknown>;
  /** When the key was issued. */
  createdAt: DateTime;
  /** When the key stops validating. Absent means it never expires. */
  expiresAt?: DateTime;
  /** When the key last validated successfully. Written at most once per throttle window. */
  lastUsedAt?: DateTime;
  /** When the key was revoked. Present means every validation fails. */
  revokedAt?: DateTime;
}

/** Input to {@link import('./api.key.service.js').ApiKeyService.create}. */
export interface ApiKeyCreateInput<K extends string = string> {
  /** Who the key acts as. */
  owner: TargetActor<K>;
  /** Human-readable label. */
  name: string;
  /** Optional class segment embedded in the token. Base62 characters only. */
  type?: string;
  /** Scopes to grant. Defaults to none, which only satisfies scope-less checks. */
  scopes?: string[];
  /** Application-defined data. Defaults to `{}`. */
  metadata?: Record<string, unknown>;
  /** When the key should stop validating. Omit for a key that never expires. */
  expiresAt?: DateTime;
}

/**
 * Patch for {@link import('./api.key.service.js').ApiKeyService.update}.
 *
 * `expiresAt` is the one place this package uses `null`: an absent field means
 * "leave the expiry alone" and `null` means "clear it, this key never expires".
 * Those are different intents and an optional field alone cannot carry both.
 */
export interface ApiKeyUpdate {
  /** Rename the key. */
  name?: string;
  /** Replace the scope list wholesale. */
  scopes?: string[];
  /** Replace the metadata wholesale. */
  metadata?: Record<string, unknown>;
  /** Set a new expiry, or `null` to remove it. */
  expiresAt?: DateTime | null;
}

/**
 * A freshly issued key and its plaintext token.
 *
 * The only place the token exists after generation. Hand it to the caller once;
 * nothing can recover it afterwards.
 */
export interface ApiKeyIssued<K extends string = string> {
  /** The stored key record. */
  key: ApiKey<K>;
  /** The complete token. Show once, never log. */
  token: string;
}

/**
 * Why {@link import('./api.key.service.js').ApiKeyService.validate} refused a token.
 *
 * - `malformed` — wrong prefix, wrong shape, non-base62 characters, or a failed
 *   checksum. Decided without touching storage.
 * - `unknown` — well-formed, but no key has that hash.
 * - `revoked` / `expired` — the key exists and is no longer usable.
 * - `policy_denied` — `'auth.api.key.allowed'` refused this key.
 */
export type ApiKeyRejectionReason = 'malformed' | 'unknown' | 'revoked' | 'expired' | 'policy_denied';

/**
 * Outcome of validating a token.
 *
 * A discriminated union rather than a throw, because the
 * {@link import('../authentication.handler.js').AuthenticationHandler} contract
 * needs to turn a bad credential into `invalidAuthenticationSession`, and a
 * handler that throws stops the whole chain.
 */
export type ApiKeyValidation<K extends string = string> = { kind: 'valid'; key: ApiKey<K> } | { kind: 'invalid'; reason: ApiKeyRejectionReason };

/**
 * The shape placed at `session.claims.apiKey` when a key authenticates a request.
 *
 * Its presence is what tells a policy the caller is a machine, and it carries
 * everything a route needs without a second lookup. The `secretHash` is
 * deliberately absent.
 */
export interface ApiKeySessionClaim<K extends string = string> {
  /** The key's id, suitable for rate-limit keys and audit lines. */
  id: string;
  /** The key's label. */
  name: string;
  /** The key's class segment, when it has one. */
  type?: string;
  /** Who the key acts as. */
  owner: TargetActor<K>;
  /** Scopes the key carries. */
  scopes: string[];
  /** Application-defined data attached to the key. */
  metadata: Record<string, unknown>;
}
