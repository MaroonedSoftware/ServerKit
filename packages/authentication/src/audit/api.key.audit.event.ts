import type { ApiKeyRejectionReason } from '../apikey/types.js';
import type { AuditEvent } from './types.js';

/** Key detail carried on API key events. Never the token, only its display hint. */
export interface AuditApiKeyData {
  /** The key's id. */
  id: string;
  /** The key's label. */
  name?: string;
  /** The key's leading characters. Safe to display; not a credential. */
  hint?: string;
  /** Organisation the key is scoped to, when its owner carries one. */
  organizationId?: string;
}

/**
 * API key lifecycle and authentication events.
 *
 * Type names match the strings `ApiKeyService` already logs, so an event and its
 * log line read identically and an operator moving from one to the other does
 * not have to learn a second vocabulary.
 */
export type ApiKeyAuditEvent =
  /** A key was issued. The token existed exactly once, at this moment, and is not recorded. */
  | AuditEvent<'api_key.created', AuditApiKeyData & { expiresAt?: string; scopes: string[] }>
  /**
   * A key authenticated a request.
   *
   * The machine equivalent of a login success, and the event `ApiKeyService` does
   * not log today: only rejections were visible.
   */
  | AuditEvent<'api_key.authenticated', AuditApiKeyData & { scopes: string[] }>
  /**
   * A presented key was refused.
   *
   * `malformed` and `unknown` carry no key detail because there is no key to
   * attribute them to. They are also the ordinary case behind a handler chain,
   * where every JWT reaches the API key handler, so treat their volume as
   * traffic rather than as attack.
   */
  | AuditEvent<'api_key.rejected', Partial<AuditApiKeyData> & { reason: ApiKeyRejectionReason }>
  /** A key's label, scopes, metadata, or expiry changed. */
  | AuditEvent<'api_key.updated', AuditApiKeyData>
  /** A key was given a new token, invalidating the previous one immediately. */
  | AuditEvent<'api_key.rotated', AuditApiKeyData>
  /** A key was withdrawn. Takes effect on the next request. */
  | AuditEvent<'api_key.revoked', AuditApiKeyData>
  /** Every active key for an owner was withdrawn, with the count. */
  | AuditEvent<'api_key.revoked_all', { organizationId?: string; count: number }>
  /** A key record was destroyed rather than withdrawn. */
  | AuditEvent<'api_key.deleted', { id: string }>;
