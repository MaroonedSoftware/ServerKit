import { vi } from 'vitest';
import { DateTime } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { AuditRecorder } from '../../src/audit/audit.recorder.js';
import type { AuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';
import { OAuthClientRepository } from '../../src/oauth/oauth.client.repository.js';
import type { OAuthClient } from '../../src/oauth/oauth.types.js';

/** A Map-backed cache with real set-if-absent semantics. */
export const makeCache = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    add: vi.fn(async (key: string, value: string) => (store.has(key) ? false : (store.set(key, value), true))),
    update: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    delete: vi.fn(async (key: string) => (store.delete(key) ? key : null)),
  } as unknown as CacheProvider & { store: Map<string, string> };
};

/** A Map-backed client repository. */
export class FakeClientRepository extends OAuthClientRepository {
  readonly clients = new Map<string, OAuthClient>();
  readonly touches: { clientId: string; at: DateTime; extendTo?: DateTime }[] = [];

  async findByClientId(clientId: string) {
    return this.clients.get(clientId);
  }

  async create(client: OAuthClient) {
    this.clients.set(client.clientId, client);
    return client;
  }

  async touchLastUsed(clientId: string, at: DateTime, extendTo?: DateTime) {
    this.touches.push({ clientId, at, ...(extendTo === undefined ? {} : { extendTo }) });
  }

  async deleteExpired(before: DateTime) {
    let count = 0;
    for (const [id, client] of this.clients) {
      if (client.expiresAt !== undefined && client.expiresAt < before) {
        this.clients.delete(id);
        count += 1;
      }
    }
    return count;
  }
}

/** An audit recorder that keeps every event. */
export const makeCapturingRecorder = () => {
  const events: AuthenticationAuditEvent[] = [];
  const recorder = new AuditRecorder({ record: (event: AuthenticationAuditEvent) => void events.push(event) } as unknown as AuditSink);
  return { events, recorder };
};
