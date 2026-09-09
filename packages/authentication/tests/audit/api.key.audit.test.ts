import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import type { Logger } from '@maroonedsoftware/logger';
import type { PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { ApiKeyService, ApiKeyServiceOptions } from '../../src/apikey/api.key.service.js';
import type { ApiKeyRepository, ApiKeyUpdatePatch } from '../../src/apikey/api.key.repository.js';
import type { ApiKey } from '../../src/apikey/types.js';
import { AuditRecorder } from '../../src/audit/audit.recorder.js';
import { AuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';
import type { TargetActor } from '../../src/mfa/types.js';

const owner: TargetActor = { kind: 'user', actorId: 'user-1', organizationId: 'org-9' };

const makeCache = () => {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    add: vi.fn(async (k: string, v: string) => (store.has(k) ? false : (store.set(k, v), true))),
    update: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    delete: vi.fn(async (k: string) => (store.delete(k) ? k : null)),
  } as unknown as CacheProvider;
};

const makePolicyService = (result: PolicyResult = { allowed: true }) =>
  ({ check: vi.fn(async () => result), assert: vi.fn(async () => undefined) }) as unknown as PolicyService;

const makeLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const makeRepository = () => {
  const byId = new Map<string, ApiKey>();
  const repo = {
    byId,
    create: vi.fn(async (key: ApiKey) => (byId.set(key.id, key), key)),
    findById: vi.fn(async (id: string) => byId.get(id)),
    findBySecretHash: vi.fn(async (h: string) => [...byId.values()].find(k => k.secretHash === h)),
    listByOwner: vi.fn(async () => [...byId.values()]),
    update: vi.fn(async (id: string, patch: ApiKeyUpdatePatch) => {
      const { expiresAt, ...rest } = patch;
      const next = { ...byId.get(id)!, ...rest } as ApiKey;
      if (expiresAt === null) delete next.expiresAt;
      else if (expiresAt !== undefined) next.expiresAt = expiresAt;
      byId.set(id, next);
      return next;
    }),
    revoke: vi.fn(async (id: string, at: DateTime) => {
      const next = { ...byId.get(id)!, revokedAt: at };
      byId.set(id, next);
      return next;
    }),
    revokeAllForOwner: vi.fn(async (_o: TargetActor, at: DateTime) => {
      let n = 0;
      for (const [id, k] of byId) if (!k.revokedAt) (byId.set(id, { ...k, revokedAt: at }), n++);
      return n;
    }),
    touchLastUsed: vi.fn(async () => undefined),
    delete: vi.fn(async (id: string) => void byId.delete(id)),
  };
  return repo as unknown as ApiKeyRepository & typeof repo;
};

let repository: ReturnType<typeof makeRepository>;
let policyService: PolicyService;
let logger: Logger;
let events: AuthenticationAuditEvent[];

const build = () => {
  const sink = { record: (e: AuthenticationAuditEvent) => void events.push(e) } as unknown as AuditSink;
  return new ApiKeyService(new ApiKeyServiceOptions(), repository, makeCache(), policyService, logger, new AuditRecorder(sink));
};

beforeEach(() => {
  vi.clearAllMocks();
  repository = makeRepository();
  policyService = makePolicyService();
  logger = makeLogger();
  events = [];
});

describe('API key audit events', () => {
  it('records an issue with the hint and scopes but never the token', async () => {
    const { key, token } = await build().create({ owner, name: 'CI', type: 'live', scopes: ['deploy'] });

    expect(events).toMatchObject([
      {
        type: 'api_key.created',
        category: 'credential',
        outcome: 'success',
        actorId: 'user-1',
        data: { id: key.id, name: 'CI', hint: 'sk_live_', organizationId: 'org-9', scopes: ['deploy'] },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it('records a successful authentication, the machine login the service never logged', async () => {
    const service = build();
    const { key, token } = await service.create({ owner, name: 'CI', scopes: ['deploy'] });
    events.length = 0;

    await service.authenticate(token);

    expect(events).toMatchObject([
      { type: 'api_key.authenticated', category: 'machine', outcome: 'success', actorId: 'user-1', data: { id: key.id } },
    ]);
  });

  it('records a rejection with the key when there is one to attribute', async () => {
    const service = build();
    const { key, token } = await service.create({ owner, name: 'CI' });
    await service.revoke(key.id);
    events.length = 0;

    await service.validate(token);

    expect(events).toMatchObject([
      { type: 'api_key.rejected', category: 'machine', outcome: 'failure', actorId: 'user-1', data: { reason: 'revoked' } },
    ]);
  });

  it('records a malformed credential without inventing an actor', async () => {
    // Every JWT behind a handler chain reaches this path, so it must attribute
    // nothing and stay cheap.
    await build().validate('eyJhbGciOiJIUzI1NiJ9.e30.sig');

    expect(events).toMatchObject([{ type: 'api_key.rejected', outcome: 'failure', data: { reason: 'malformed' } }]);
    expect(events[0]!.actorId).toBeUndefined();
    expect(repository.findBySecretHash).not.toHaveBeenCalled();
  });

  it('records an expired key distinctly from an unknown one', async () => {
    const service = build();
    const { key, token } = await service.create({ owner, name: 'CI' });
    repository.byId.set(key.id, { ...repository.byId.get(key.id)!, expiresAt: DateTime.utc().minus({ minutes: 1 }) });
    events.length = 0;

    await service.validate(token);

    expect(events[0]).toMatchObject({ type: 'api_key.rejected', data: { reason: 'expired', id: key.id } });
  });

  it('records a rotation, and the old token then reads as unknown', async () => {
    const service = build();
    const { key, token: original } = await service.create({ owner, name: 'CI' });
    events.length = 0;

    const rotated = await service.rotate(key.id);
    await service.validate(original);

    expect(events.map(e => e.type)).toEqual(['api_key.rotated', 'api_key.rejected']);
    expect(JSON.stringify(events)).not.toContain(original);
    expect(JSON.stringify(events)).not.toContain(rotated.token);
  });

  it('records update, revoke, revoke-all, and delete', async () => {
    const service = build();
    const { key } = await service.create({ owner, name: 'CI' });
    await service.create({ owner, name: 'other' });
    events.length = 0;

    await service.update(key.id, { name: 'renamed' });
    await service.revoke(key.id);
    await service.revokeAllForOwner(owner);
    await service.delete(key.id);

    expect(events.map(e => e.type)).toEqual(['api_key.updated', 'api_key.revoked', 'api_key.revoked_all', 'api_key.deleted']);
    expect(events.find(e => e.type === 'api_key.revoked_all')).toMatchObject({ data: { count: 1, organizationId: 'org-9' } });
  });

  it('emits nothing when a create is refused, since nothing happened', async () => {
    policyService = makePolicyService({ allowed: false, reason: 'plan_excludes_api_keys' });

    await expect(build().create({ owner, name: 'CI' })).rejects.toMatchObject({ statusCode: 403 });
    expect(events).toEqual([]);
  });
});

describe('no secret ever reaches an event', () => {
  it('keeps tokens and hashes out of every event across the whole lifecycle', async () => {
    // The test that matters most: drive every emitting path and scan the
    // serialised events for the values that must never be recorded.
    const service = build();
    const created = await service.create({ owner, name: 'CI', type: 'live', scopes: ['deploy'], metadata: { repo: 'serverkit' } });
    await service.authenticate(created.token);
    const rotated = await service.rotate(created.key.id);
    await service.authenticate(rotated.token);
    await service.validate(created.token);
    await service.update(created.key.id, { name: 'renamed' });
    await service.revoke(created.key.id);
    await service.validate(rotated.token);
    await service.revokeAllForOwner(owner);
    await service.delete(created.key.id);

    const serialised = JSON.stringify(events);
    for (const secret of [created.token, rotated.token, created.key.secretHash, rotated.key.secretHash]) {
      expect(serialised).not.toContain(secret);
    }
    expect(events.length).toBeGreaterThan(8);
  });
});
