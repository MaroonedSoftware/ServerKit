import type { ScimGroup } from '../types/scim.group.js';
import type { ScimListQuery, ScimListResult } from './repository.types.js';

/**
 * Storage contract for SCIM `Group` resources. See
 * {@link ScimUserRepository} for general implementation guidance.
 */
export abstract class ScimGroupRepository {
  /** Look up a group by server-assigned id. */
  abstract findById(id: string): Promise<ScimGroup | undefined>;

  /** Look up a group by `displayName`. */
  abstract findByDisplayName(displayName: string): Promise<ScimGroup | undefined>;

  /** Look up a group by `externalId`. */
  abstract findByExternalId(externalId: string): Promise<ScimGroup | undefined>;

  /** List groups matching a parsed query. */
  abstract list(query: ScimListQuery): Promise<ScimListResult<ScimGroup>>;

  /** Persist a new group. */
  abstract create(group: ScimGroup): Promise<ScimGroup>;

  /** Replace the entirety of an existing group (PUT semantics). */
  abstract replace(id: string, group: ScimGroup): Promise<ScimGroup>;

  /** Delete a group by id. */
  abstract delete(id: string): Promise<void>;
}
