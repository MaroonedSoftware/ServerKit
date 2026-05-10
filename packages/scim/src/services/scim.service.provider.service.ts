import { Injectable } from 'injectkit';
import { buildServiceProviderConfig, type ScimServiceProviderConfig, type ScimServiceProviderConfigOptions } from '../schemas/service.provider.config.schema.js';
import { coreSchemas } from '../schemas/index.js';
import { userResourceType, groupResourceType, type ScimResourceType } from '../schemas/resource.type.schema.js';
import type { ScimSchema } from '../schemas/schema.types.js';
import { scimError } from '../errors/scim.error.js';

/**
 * Serves the SCIM discovery endpoints: `/ServiceProviderConfig`, `/Schemas`,
 * and `/ResourceTypes`. The config is fixed at construction time — what the
 * server advertises must match what the router actually implements.
 */
@Injectable()
export class ScimServiceProviderService {
  private readonly config: ScimServiceProviderConfig;
  private readonly schemas: ScimSchema[];
  private readonly resourceTypes: ScimResourceType[];

  constructor(options: ScimServiceProviderConfigOptions = {}) {
    this.config = buildServiceProviderConfig(options);
    this.schemas = coreSchemas;
    this.resourceTypes = [userResourceType, groupResourceType];
  }

  /** The materialised `/ServiceProviderConfig` response. */
  getServiceProviderConfig(): ScimServiceProviderConfig {
    return this.config;
  }

  /** Every schema known to this server, served from `/Schemas`. */
  listSchemas(): ScimSchema[] {
    return this.schemas;
  }

  /**
   * Look up a single schema by its URN.
   *
   * @throws {ScimError} 404 if the URN is not registered.
   */
  getSchema(id: string): ScimSchema {
    const found = this.schemas.find(s => s.id === id);
    if (!found) throw scimError(404, undefined, 'Not Found').withDetails({ message: `Schema "${id}" not found` });
    return found;
  }

  /** Every resource type known to this server, served from `/ResourceTypes`. */
  listResourceTypes(): ScimResourceType[] {
    return this.resourceTypes;
  }

  /**
   * Look up a single resource type by id (e.g. `User`, `Group`).
   *
   * @throws {ScimError} 404 if the id is not registered.
   */
  getResourceType(id: string): ScimResourceType {
    const found = this.resourceTypes.find(rt => rt.id === id);
    if (!found) throw scimError(404, undefined, 'Not Found').withDetails({ message: `ResourceType "${id}" not found` });
    return found;
  }
}
