import { randomUUID } from 'node:crypto';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ScimUserRepository } from '../repositories/scim.user.repository.js';
import type { ScimListQuery, ScimListResult } from '../repositories/repository.types.js';
import type { ScimUser } from '../types/scim.user.js';
import type { ScimPatchOp } from '../types/patch.op.js';
import { applyScimPatch } from '../patch/patch.applier.js';
import { scimError } from '../errors/scim.error.js';
import { UserSchemaId } from '../schemas/user.schema.js';
import { EnterpriseUserSchemaId } from '../schemas/enterprise.user.schema.js';

/**
 * Application service wrapping a {@link ScimUserRepository}. Owns id and meta
 * assignment, uniqueness enforcement, and PATCH application — keeping the
 * repository focused on storage concerns.
 */
@Injectable()
export class ScimUserService {
  constructor(
    private readonly repository: ScimUserRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Fetch a single user by id.
   *
   * @throws {ScimError} 404 if no user exists with the given id.
   */
  async get(id: string): Promise<ScimUser> {
    const user = await this.repository.findById(id);
    if (!user) throw scimError(404, undefined, 'Not Found').withDetails({ message: `User "${id}" not found` });
    return user;
  }

  /**
   * List users matching a parsed SCIM query, returning the page plus the
   * total number of matches (for the `totalResults` envelope field).
   */
  async list(query: ScimListQuery): Promise<ScimListResult<ScimUser>> {
    return this.repository.list(query);
  }

  /**
   * Create a new user. Assigns a server-generated `id`, fills `meta.created`
   * and `meta.lastModified`, and ensures the resource's `schemas` includes the
   * core User URN (and the EnterpriseUser URN when the extension is present).
   *
   * @throws {ScimError} 400 `invalidValue` when `userName` is missing.
   * @throws {ScimError} 409 `uniqueness` when `userName` already exists.
   */
  async create(payload: Partial<ScimUser>): Promise<ScimUser> {
    if (!payload.userName) {
      throw scimError(400, 'invalidValue', 'Bad Request').withDetails({ message: '"userName" is required' });
    }
    const existing = await this.repository.findByUserName(payload.userName);
    if (existing) {
      throw scimError(409, 'uniqueness', 'Conflict').withDetails({ message: `userName "${payload.userName}" already exists` });
    }
    const now = new Date().toISOString();
    const id = payload.id ?? randomUUID();
    const user: ScimUser = {
      ...payload,
      id,
      userName: payload.userName,
      schemas: this.normaliseSchemas(payload.schemas, payload),
      meta: {
        resourceType: 'User',
        created: now,
        lastModified: now,
        location: `/Users/${id}`,
      },
    };
    this.logger.debug('scim: creating user', { id, userName: user.userName });
    return this.repository.create(user);
  }

  /**
   * Replace an existing user wholesale (PUT semantics). Preserves the original
   * `id` and `meta.created`; updates `meta.lastModified`.
   *
   * @throws {ScimError} 404 when no user exists with the given id.
   * @throws {ScimError} 400 `invalidValue` when `userName` is missing.
   * @throws {ScimError} 409 `uniqueness` when changing `userName` would collide
   *   with another existing user.
   */
  async replace(id: string, payload: Partial<ScimUser>): Promise<ScimUser> {
    const existing = await this.repository.findById(id);
    if (!existing) throw scimError(404, undefined, 'Not Found').withDetails({ message: `User "${id}" not found` });
    if (!payload.userName) {
      throw scimError(400, 'invalidValue', 'Bad Request').withDetails({ message: '"userName" is required' });
    }
    if (payload.userName !== existing.userName) {
      const conflict = await this.repository.findByUserName(payload.userName);
      if (conflict && conflict.id !== id) {
        throw scimError(409, 'uniqueness', 'Conflict').withDetails({ message: `userName "${payload.userName}" already exists` });
      }
    }
    const now = new Date().toISOString();
    const user: ScimUser = {
      ...payload,
      id,
      userName: payload.userName,
      schemas: this.normaliseSchemas(payload.schemas, payload),
      meta: {
        ...existing.meta,
        lastModified: now,
        location: existing.meta.location ?? `/Users/${id}`,
      },
    };
    return this.repository.replace(id, user);
  }

  /**
   * Apply a sequence of SCIM PATCH ops (RFC 7644 §3.5.2) and persist the
   * result via `replace`. Updates `meta.lastModified`.
   *
   * @throws {ScimError} 404 when no user exists with the given id.
   * @throws {ScimError} 400 propagated from {@link applyScimPatch} for invalid
   *   paths, unknown ops, or no-target failures.
   */
  async patch(id: string, ops: ScimPatchOp[]): Promise<ScimUser> {
    const existing = await this.repository.findById(id);
    if (!existing) throw scimError(404, undefined, 'Not Found').withDetails({ message: `User "${id}" not found` });
    const patched = applyScimPatch(existing as unknown as Record<string, unknown>, ops) as unknown as ScimUser;
    patched.id = existing.id;
    patched.meta = {
      ...existing.meta,
      lastModified: new Date().toISOString(),
    };
    return this.repository.replace(id, patched);
  }

  /**
   * Delete a user by id.
   *
   * @throws {ScimError} 404 when no user exists with the given id.
   */
  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) throw scimError(404, undefined, 'Not Found').withDetails({ message: `User "${id}" not found` });
    await this.repository.delete(id);
  }

  private normaliseSchemas(provided: string[] | undefined, payload: Partial<ScimUser>): string[] {
    const schemas = new Set<string>(provided ?? []);
    schemas.add(UserSchemaId);
    if (payload[EnterpriseUserSchemaId]) {
      schemas.add(EnterpriseUserSchemaId);
    }
    return Array.from(schemas);
  }
}
