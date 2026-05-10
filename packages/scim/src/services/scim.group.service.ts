import { randomUUID } from 'node:crypto';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ScimGroupRepository } from '../repositories/scim.group.repository.js';
import type { ScimListQuery, ScimListResult } from '../repositories/repository.types.js';
import type { ScimGroup } from '../types/scim.group.js';
import type { ScimPatchOp } from '../types/patch.op.js';
import { applyScimPatch } from '../patch/patch.applier.js';
import { scimError } from '../errors/scim.error.js';
import { GroupSchemaId } from '../schemas/group.schema.js';

/**
 * Application service wrapping a {@link ScimGroupRepository}. Mirrors
 * {@link ScimUserService}: id/meta assignment, uniqueness on `displayName`,
 * and PATCH application.
 */
@Injectable()
export class ScimGroupService {
  constructor(
    private readonly repository: ScimGroupRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Fetch a single group by id.
   *
   * @throws {ScimError} 404 when no group exists with the given id.
   */
  async get(id: string): Promise<ScimGroup> {
    const group = await this.repository.findById(id);
    if (!group) throw scimError(404, undefined, 'Not Found').withDetails({ message: `Group "${id}" not found` });
    return group;
  }

  /**
   * List groups matching a parsed SCIM query, returning the page plus the
   * total number of matches.
   */
  async list(query: ScimListQuery): Promise<ScimListResult<ScimGroup>> {
    return this.repository.list(query);
  }

  /**
   * Create a new group. Assigns a server-generated `id` and fills `meta`
   * timestamps.
   *
   * @throws {ScimError} 400 `invalidValue` when `displayName` is missing.
   * @throws {ScimError} 409 `uniqueness` when `displayName` already exists.
   */
  async create(payload: Partial<ScimGroup>): Promise<ScimGroup> {
    if (!payload.displayName) {
      throw scimError(400, 'invalidValue', 'Bad Request').withDetails({ message: '"displayName" is required' });
    }
    const existing = await this.repository.findByDisplayName(payload.displayName);
    if (existing) {
      throw scimError(409, 'uniqueness', 'Conflict').withDetails({ message: `displayName "${payload.displayName}" already exists` });
    }
    const now = new Date().toISOString();
    const id = payload.id ?? randomUUID();
    const group: ScimGroup = {
      ...payload,
      id,
      displayName: payload.displayName,
      schemas: this.normaliseSchemas(payload.schemas),
      meta: {
        resourceType: 'Group',
        created: now,
        lastModified: now,
        location: `/Groups/${id}`,
      },
    };
    this.logger.debug('scim: creating group', { id, displayName: group.displayName });
    return this.repository.create(group);
  }

  /**
   * Replace an existing group wholesale (PUT semantics). Preserves `id` and
   * `meta.created`; updates `meta.lastModified`.
   *
   * @throws {ScimError} 404 when no group exists with the given id.
   * @throws {ScimError} 400 `invalidValue` when `displayName` is missing.
   * @throws {ScimError} 409 `uniqueness` when changing `displayName` would collide.
   */
  async replace(id: string, payload: Partial<ScimGroup>): Promise<ScimGroup> {
    const existing = await this.repository.findById(id);
    if (!existing) throw scimError(404, undefined, 'Not Found').withDetails({ message: `Group "${id}" not found` });
    if (!payload.displayName) {
      throw scimError(400, 'invalidValue', 'Bad Request').withDetails({ message: '"displayName" is required' });
    }
    if (payload.displayName !== existing.displayName) {
      const conflict = await this.repository.findByDisplayName(payload.displayName);
      if (conflict && conflict.id !== id) {
        throw scimError(409, 'uniqueness', 'Conflict').withDetails({ message: `displayName "${payload.displayName}" already exists` });
      }
    }
    const now = new Date().toISOString();
    const group: ScimGroup = {
      ...payload,
      id,
      displayName: payload.displayName,
      schemas: this.normaliseSchemas(payload.schemas),
      meta: {
        ...existing.meta,
        lastModified: now,
        location: existing.meta.location ?? `/Groups/${id}`,
      },
    };
    return this.repository.replace(id, group);
  }

  /**
   * Apply a sequence of SCIM PATCH ops and persist the result. Updates
   * `meta.lastModified`.
   *
   * @throws {ScimError} 404 when no group exists with the given id.
   * @throws {ScimError} 400 propagated from {@link applyScimPatch}.
   */
  async patch(id: string, ops: ScimPatchOp[]): Promise<ScimGroup> {
    const existing = await this.repository.findById(id);
    if (!existing) throw scimError(404, undefined, 'Not Found').withDetails({ message: `Group "${id}" not found` });
    const patched = applyScimPatch(existing as unknown as Record<string, unknown>, ops) as unknown as ScimGroup;
    patched.id = existing.id;
    patched.meta = {
      ...existing.meta,
      lastModified: new Date().toISOString(),
    };
    return this.repository.replace(id, patched);
  }

  /**
   * Delete a group by id.
   *
   * @throws {ScimError} 404 when no group exists with the given id.
   */
  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) throw scimError(404, undefined, 'Not Found').withDetails({ message: `Group "${id}" not found` });
    await this.repository.delete(id);
  }

  private normaliseSchemas(provided: string[] | undefined): string[] {
    const schemas = new Set<string>(provided ?? []);
    schemas.add(GroupSchemaId);
    return Array.from(schemas);
  }
}
