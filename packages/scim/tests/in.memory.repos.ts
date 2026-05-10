import type { ScimUser } from '../src/types/scim.user.js';
import type { ScimGroup } from '../src/types/scim.group.js';
import type { ScimListQuery, ScimListResult } from '../src/repositories/repository.types.js';
import { ScimUserRepository } from '../src/repositories/scim.user.repository.js';
import { ScimGroupRepository } from '../src/repositories/scim.group.repository.js';

/**
 * Trivial in-memory `ScimUserRepository` used by service and router tests.
 * Filter matching is intentionally limited to `userName eq` for simplicity —
 * exhaustive filter coverage lives in the parser tests.
 */
export class InMemoryUserRepository extends ScimUserRepository {
  readonly users = new Map<string, ScimUser>();

  async findById(id: string): Promise<ScimUser | undefined> {
    return this.users.get(id);
  }

  async findByUserName(userName: string): Promise<ScimUser | undefined> {
    for (const u of this.users.values()) {
      if (u.userName.toLowerCase() === userName.toLowerCase()) return u;
    }
    return undefined;
  }

  async findByExternalId(externalId: string): Promise<ScimUser | undefined> {
    for (const u of this.users.values()) {
      if (u.externalId === externalId) return u;
    }
    return undefined;
  }

  async list(query: ScimListQuery): Promise<ScimListResult<ScimUser>> {
    const all = Array.from(this.users.values());
    const filtered = applyTrivialFilter(all, query);
    const start = (query.startIndex - 1);
    const page = filtered.slice(start, start + query.count);
    return { resources: page, totalResults: filtered.length };
  }

  async create(user: ScimUser): Promise<ScimUser> {
    this.users.set(user.id, user);
    return user;
  }

  async replace(id: string, user: ScimUser): Promise<ScimUser> {
    this.users.set(id, user);
    return user;
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }
}

export class InMemoryGroupRepository extends ScimGroupRepository {
  readonly groups = new Map<string, ScimGroup>();

  async findById(id: string): Promise<ScimGroup | undefined> {
    return this.groups.get(id);
  }

  async findByDisplayName(displayName: string): Promise<ScimGroup | undefined> {
    for (const g of this.groups.values()) {
      if (g.displayName.toLowerCase() === displayName.toLowerCase()) return g;
    }
    return undefined;
  }

  async findByExternalId(externalId: string): Promise<ScimGroup | undefined> {
    for (const g of this.groups.values()) {
      if (g.externalId === externalId) return g;
    }
    return undefined;
  }

  async list(query: ScimListQuery): Promise<ScimListResult<ScimGroup>> {
    const all = Array.from(this.groups.values());
    const start = (query.startIndex - 1);
    const page = all.slice(start, start + query.count);
    return { resources: page, totalResults: all.length };
  }

  async create(group: ScimGroup): Promise<ScimGroup> {
    this.groups.set(group.id, group);
    return group;
  }

  async replace(id: string, group: ScimGroup): Promise<ScimGroup> {
    this.groups.set(id, group);
    return group;
  }

  async delete(id: string): Promise<void> {
    this.groups.delete(id);
  }
}

const applyTrivialFilter = (users: ScimUser[], query: ScimListQuery): ScimUser[] => {
  if (!query.filter) return users;
  const filter = query.filter;
  if (filter.kind === 'comparison' && filter.attribute === 'userName' && filter.operator === 'eq') {
    return users.filter(u => u.userName === filter.value);
  }
  return users;
};

export const silentLogger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
};
