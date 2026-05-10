import type { ScimUser } from '../types/scim.user.js';
import type { ScimListQuery, ScimListResult } from './repository.types.js';

/**
 * Storage contract for SCIM `User` resources. The package ships only this
 * abstract class — implement it against your datastore (Kysely, Prisma,
 * Drizzle, in-memory) and pass the instance to {@link createScimRouter}.
 *
 * Implementations are responsible for:
 * - Translating the parsed filter AST in {@link ScimListQuery.filter} into a
 *   native query.
 * - Honouring `startIndex` (1-based) and `count` for pagination.
 * - Returning the total number of matching resources, not just the page size.
 * - Persisting `meta.created` / `meta.lastModified` timestamps.
 *
 * Modeled as an abstract class so the runtime reference is a valid InjectKit
 * token (interfaces aren't preserved at runtime).
 */
export abstract class ScimUserRepository {
  /** Look up a user by server-assigned id. Return `undefined` if not found. */
  abstract findById(id: string): Promise<ScimUser | undefined>;

  /** Look up a user by `userName` (case-insensitive per RFC 7643). */
  abstract findByUserName(userName: string): Promise<ScimUser | undefined>;

  /** Look up a user by `externalId` (client-supplied identifier). */
  abstract findByExternalId(externalId: string): Promise<ScimUser | undefined>;

  /** List users matching a parsed query. */
  abstract list(query: ScimListQuery): Promise<ScimListResult<ScimUser>>;

  /** Persist a fully-formed user. `id`, `schemas`, and `meta` are already populated by {@link ScimUserService}. */
  abstract create(user: ScimUser): Promise<ScimUser>;

  /** Replace the entirety of an existing user (PUT semantics). */
  abstract replace(id: string, user: ScimUser): Promise<ScimUser>;

  /** Delete a user by id. Implementations may treat missing ids as a no-op. */
  abstract delete(id: string): Promise<void>;
}
