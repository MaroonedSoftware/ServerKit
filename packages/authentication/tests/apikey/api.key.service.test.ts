import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import type { Logger } from '@maroonedsoftware/logger';
import type { PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { invalidAuthenticationSession } from '../../src/types.js';
import type { TargetActor } from '../../src/mfa/types.js';
import { ApiKeyService, ApiKeyServiceOptions } from '../../src/apikey/api.key.service.js';
import type { ApiKeyRepository, ApiKeyUpdatePatch } from '../../src/apikey/api.key.repository.js';
import { hashApiKeyToken, parseApiKeyToken } from '../../src/apikey/api.key.token.js';
import type { ApiKey, ApiKeySessionClaim } from '../../src/apikey/types.js';

const owner: TargetActor = { kind: 'user', actorId: 'user-1' };
const otherOwner: TargetActor = { kind: 'user', actorId: 'user-2' };

const makeCache = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    add: vi.fn(async (key: string, value: string) => {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    }),
    update: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had ? key : null;
    }),
  } as unknown as CacheProvider & { store: Map<string, string> };
};

const makePolicyService = (result: PolicyResult = { allowed: true }) =>
  ({
    check: vi.fn(async () => result),
    assert: vi.fn(async () => undefined),
  }) as unknown as PolicyService;

const makeLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const makeRepository = () => {
  const byId = new Map<string, ApiKey>();

  const repository = {
    byId,
    create: vi.fn(async (key: ApiKey) => {
      byId.set(key.id, key);
      return key;
    }),
    findById: vi.fn(async (id: string) => byId.get(id)),
    findBySecretHash: vi.fn(async (secretHash: string) => [...byId.values()].find(key => key.secretHash === secretHash)),
    listByOwner: vi.fn(async (target: TargetActor, options?: { includeInactive?: boolean }) =>
      [...byId.values()].filter(key => key.owner.actorId === target.actorId && (options?.includeInactive === true || !key.revokedAt)),
    ),
    update: vi.fn(async (id: string, patch: ApiKeyUpdatePatch) => {
      const existing = byId.get(id)!;
      const { expiresAt, ...rest } = patch;
      const next: ApiKey = { ...existing, ...rest };
      if (expiresAt === null) delete next.expiresAt;
      else if (expiresAt !== undefined) next.expiresAt = expiresAt;
      byId.set(id, next);
      return next;
    }),
    revoke: vi.fn(async (id: string, at: DateTime) => {
      const existing = byId.get(id)!;
      const next = { ...existing, revokedAt: existing.revokedAt ?? at };
      byId.set(id, next);
      return next;
    }),
    revokeAllForOwner: vi.fn(async (target: TargetActor, at: DateTime) => {
      let count = 0;
      for (const [id, key] of byId) {
        if (key.owner.actorId !== target.actorId || key.revokedAt) continue;
        byId.set(id, { ...key, revokedAt: at });
        count++;
      }
      return count;
    }),
    touchLastUsed: vi.fn(async (id: string, at: DateTime) => {
      const existing = byId.get(id);
      if (existing) byId.set(id, { ...existing, lastUsedAt: at });
    }),
    delete: vi.fn(async (id: string) => {
      byId.delete(id);
    }),
  };

  return repository as unknown as ApiKeyRepository & typeof repository;
};

let repository: ReturnType<typeof makeRepository>;
let cache: ReturnType<typeof makeCache>;
let policyService: PolicyService;
let logger: Logger;

const build = (options = new ApiKeyServiceOptions()) => new ApiKeyService(options, repository, cache, policyService, logger);

beforeEach(() => {
  vi.clearAllMocks();
  repository = makeRepository();
  cache = makeCache();
  policyService = makePolicyService();
  logger = makeLogger();
});

describe('create', () => {
  it('returns a parseable token and stores only its hash', async () => {
    const service = build();

    const { key, token } = await service.create({ owner, name: 'CI deploy', type: 'live' });

    expect(parseApiKeyToken(token, 'sk')).toEqual({ type: 'live', body: expect.any(String) });
    expect(key.secretHash).toBe(hashApiKeyToken(token));
    // The token must not be recoverable from anything persisted.
    expect(JSON.stringify(repository.byId.get(key.id))).not.toContain(token);
  });

  it('records a hint that shows the prefix and not the secret', async () => {
    const service = build();

    const { key, token } = await service.create({ owner, name: 'CI deploy', type: 'live' });

    expect(key.hint).toBe('sk_live_');
    expect(token.startsWith(key.hint)).toBe(true);
    expect(key.hint.length).toBeLessThan(token.length / 4);
  });

  it('issues a distinct token every time', async () => {
    const service = build();

    const first = await service.create({ owner, name: 'one' });
    const second = await service.create({ owner, name: 'one' });

    expect(first.token).not.toBe(second.token);
    expect(first.key.id).not.toBe(second.key.id);
  });

  it('defaults scopes and metadata to empty', async () => {
    const service = build();

    const { key } = await service.create({ owner, name: 'bare' });

    expect(key.scopes).toEqual([]);
    expect(key.metadata).toEqual({});
    expect(key.expiresAt).toBeUndefined();
    expect(key.type).toBeUndefined();
  });

  it('honours a custom prefix', async () => {
    const service = build(new ApiKeyServiceOptions('acme'));

    const { token } = await service.create({ owner, name: 'k' });

    expect(token.startsWith('acme_')).toBe(true);
    expect(parseApiKeyToken(token, 'acme')).toBeDefined();
  });

  it('rejects an expiry in the past', async () => {
    const service = build();

    await expect(service.create({ owner, name: 'k', expiresAt: DateTime.utc().minus({ minutes: 1 }) })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an expiry beyond maxLifetime', async () => {
    const service = build(new ApiKeyServiceOptions('sk', 32, Duration.fromObject({ days: 30 })));

    await expect(service.create({ owner, name: 'k', expiresAt: DateTime.utc().plus({ days: 31 }) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.create({ owner, name: 'k', expiresAt: DateTime.utc().plus({ days: 29 }) })).resolves.toBeDefined();
  });

  it('refuses when the policy denies', async () => {
    policyService = makePolicyService({ allowed: false, reason: 'plan_does_not_include_api_keys' });
    const service = build();

    await expect(service.create({ owner, name: 'k' })).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('never logs the token', async () => {
    const service = build();

    const { token } = await service.create({ owner, name: 'k' });

    const logged = (logger.info as ReturnType<typeof vi.fn>).mock.calls.flat().map(arg => JSON.stringify(arg));
    expect(logged.some(line => line.includes(token))).toBe(false);
  });
});

describe('validate', () => {
  it('accepts a freshly issued token', async () => {
    const service = build();
    const { key, token } = await service.create({ owner, name: 'k' });

    await expect(service.validate(token)).resolves.toEqual({ kind: 'valid', key: expect.objectContaining({ id: key.id }) });
  });

  it('rejects a malformed token without touching storage', async () => {
    const service = build();
    const { token } = await service.create({ owner, name: 'k' });
    repository.findBySecretHash.mockClear();

    for (const bad of ['', 'not-a-token', 'Bearer', 'eyJhbGciOiJSUzI1NiJ9.e30.sig', `${token}x`, token.slice(0, -1)]) {
      await expect(service.validate(bad)).resolves.toEqual({ kind: 'invalid', reason: 'malformed' });
    }

    // The whole point of the checksum: a JWT arriving here costs no query.
    expect(repository.findBySecretHash).not.toHaveBeenCalled();
  });

  it('rejects a well-formed token nobody issued', async () => {
    const service = build();
    const { token } = await service.create({ owner, name: 'k' });
    await service.delete((await service.listForOwner(owner))[0]!.id);

    await expect(service.validate(token)).resolves.toEqual({ kind: 'invalid', reason: 'unknown' });
  });

  it('rejects a revoked token', async () => {
    const service = build();
    const { key, token } = await service.create({ owner, name: 'k' });
    await service.revoke(key.id);

    await expect(service.validate(token)).resolves.toEqual({ kind: 'invalid', reason: 'revoked' });
  });

  it('rejects an expired token at the boundary', async () => {
    const service = build();
    const { key, token } = await service.create({ owner, name: 'k', expiresAt: DateTime.utc().plus({ minutes: 5 }) });

    await expect(service.validate(token)).resolves.toMatchObject({ kind: 'valid' });

    // Expiry is inclusive: a key expiring exactly now is already dead.
    repository.byId.set(key.id, { ...repository.byId.get(key.id)!, expiresAt: DateTime.utc() });
    await expect(service.validate(token)).resolves.toEqual({ kind: 'invalid', reason: 'expired' });
  });

  it('rejects when the policy denies at validate time', async () => {
    const service = build();
    const { token } = await service.create({ owner, name: 'k' });

    (policyService.check as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, reason: 'organisation_suspended' });

    // A denial is a rejection, never a throw: a throw would stop the handler chain.
    await expect(service.validate(token)).resolves.toEqual({ kind: 'invalid', reason: 'policy_denied' });
  });

  it('logs a withdrawn key at warn and an unrecognised one at debug', async () => {
    const service = build();
    const { key, token } = await service.create({ owner, name: 'k' });
    await service.revoke(key.id);
    (logger.warn as ReturnType<typeof vi.fn>).mockClear();

    await service.validate(token);
    expect(logger.warn).toHaveBeenCalledWith('api_key.rejected', expect.objectContaining({ reason: 'revoked' }));

    // Every JWT behind a chain reaches this path, so it must not be noisy.
    await service.validate('eyJhbGciOiJIUzI1NiJ9.e30.x');
    expect(logger.debug).toHaveBeenCalledWith('api_key.rejected', { reason: 'malformed' });
  });

  it('throttles lastUsedAt writes to one per window', async () => {
    const service = build();
    const { token } = await service.create({ owner, name: 'k' });

    await service.validate(token);
    await service.validate(token);
    await service.validate(token);

    expect(repository.touchLastUsed).toHaveBeenCalledTimes(1);
  });

  it('still authenticates when the cache is down', async () => {
    const service = build();
    const { token } = await service.create({ owner, name: 'k' });
    (cache.add as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('redis is gone'));

    await expect(service.validate(token)).resolves.toMatchObject({ kind: 'valid' });
    expect(logger.warn).toHaveBeenCalledWith('api_key.touch_failed', expect.objectContaining({ error: 'redis is gone' }));
  });
});

describe('authenticate', () => {
  it('mints a session carrying the key claim and one possession factor', async () => {
    const service = build();
    const { key, token } = await service.create({ owner, name: 'CI', type: 'live', scopes: ['deploy'], metadata: { repo: 'serverkit' } });

    const session = await service.authenticate(token);

    expect(session.subject).toBe('user-1');
    expect(session.factors).toEqual([
      { issuedAt: expect.anything(), authenticatedAt: expect.anything(), method: 'apikey', methodId: key.id, kind: 'possession' },
    ]);
    expect(session.claims.apiKey).toEqual({
      id: key.id,
      name: 'CI',
      type: 'live',
      owner,
      scopes: ['deploy'],
      metadata: { repo: 'serverkit' },
    } satisfies ApiKeySessionClaim);
  });

  it('never puts the token or its hash in the session', async () => {
    const service = build();
    const { key, token } = await service.create({ owner, name: 'k' });

    const session = await service.authenticate(token);
    const serialised = JSON.stringify(session);

    expect(session.sessionToken).not.toBe(token);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(key.secretHash);
  });

  it('caps the session at the key expiry when the key expires sooner', async () => {
    const expiresAt = DateTime.utc().plus({ seconds: 30 });
    const service = build();
    const { token } = await service.create({ owner, name: 'k', expiresAt });

    const session = await service.authenticate(token);

    expect(session.expiresAt.toMillis()).toBe(expiresAt.toMillis());
  });

  it('uses the configured session lifetime when the key outlives it', async () => {
    const service = build(new ApiKeyServiceOptions('sk', 32, undefined, Duration.fromObject({ minutes: 2 })));
    const { token } = await service.create({ owner, name: 'k', expiresAt: DateTime.utc().plus({ days: 30 }) });

    const session = await service.authenticate(token);

    expect(session.expiresAt.diff(session.issuedAt).as('minutes')).toBeCloseTo(2, 5);
  });

  it('returns the sentinel for an invalid token', async () => {
    const service = build();

    await expect(service.authenticate('sk_nonsense')).resolves.toBe(invalidAuthenticationSession);
  });

  it('produces a session the default MFA gate rejects', async () => {
    // One possession factor is not MFA. A key must not reach an MFA-gated route
    // just because it authenticated.
    const service = build();
    const { token } = await service.create({ owner, name: 'k' });

    const session = await service.authenticate(token);

    expect(session.factors).toHaveLength(1);
    expect(session.factors.every(factor => factor.kind === 'knowledge')).toBe(false);
  });
});

describe('rotate', () => {
  it('issues a new token, invalidates the old one, and keeps the identity', async () => {
    const service = build();
    const { key, token: original } = await service.create({ owner, name: 'CI', type: 'live', scopes: ['deploy'], metadata: { a: 1 } });

    const rotated = await service.rotate(key.id);

    expect(rotated.token).not.toBe(original);
    expect(rotated.key.id).toBe(key.id);
    expect(rotated.key).toMatchObject({ name: 'CI', type: 'live', scopes: ['deploy'], metadata: { a: 1 } });
    await expect(service.validate(original)).resolves.toEqual({ kind: 'invalid', reason: 'unknown' });
    await expect(service.validate(rotated.token)).resolves.toMatchObject({ kind: 'valid' });
  });

  it('updates the hint to match the new token', async () => {
    const service = build();
    const { key } = await service.create({ owner, name: 'k', type: 'live' });

    const rotated = await service.rotate(key.id);

    expect(rotated.token.startsWith(rotated.key.hint)).toBe(true);
  });

  it('refuses to rotate a revoked key', async () => {
    const service = build();
    const { key } = await service.create({ owner, name: 'k' });
    await service.revoke(key.id);

    // Rotating would quietly resurrect a withdrawn credential.
    await expect(service.rotate(key.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('404s on an unknown id', async () => {
    await expect(build().rotate('nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('revoke and revokeAllForOwner', () => {
  it('takes effect on the next validation with no TTL to wait out', async () => {
    const service = build();
    const { key, token } = await service.create({ owner, name: 'k' });

    await expect(service.validate(token)).resolves.toMatchObject({ kind: 'valid' });
    await service.revoke(key.id);
    await expect(service.validate(token)).resolves.toEqual({ kind: 'invalid', reason: 'revoked' });
  });

  it('revokes only the named owner and reports the count', async () => {
    const service = build();
    const mine = await service.create({ owner, name: 'a' });
    await service.create({ owner, name: 'b' });
    const theirs = await service.create({ owner: otherOwner, name: 'c' });

    await expect(service.revokeAllForOwner(owner)).resolves.toBe(2);

    await expect(service.validate(mine.token)).resolves.toEqual({ kind: 'invalid', reason: 'revoked' });
    await expect(service.validate(theirs.token)).resolves.toMatchObject({ kind: 'valid' });
  });

  it('reports zero when the owner has nothing active', async () => {
    await expect(build().revokeAllForOwner(owner)).resolves.toBe(0);
  });

  it('404s on an unknown id', async () => {
    await expect(build().revoke('nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('update, list, and delete', () => {
  it('clears an expiry with null and leaves it alone when omitted', async () => {
    const service = build();
    const { key } = await service.create({ owner, name: 'k', expiresAt: DateTime.utc().plus({ days: 1 }) });

    const renamed = await service.update(key.id, { name: 'renamed' });
    expect(renamed.expiresAt).toBeDefined();

    const cleared = await service.update(key.id, { expiresAt: null });
    expect(cleared.expiresAt).toBeUndefined();
  });

  it('rejects an update that pushes the expiry past maxLifetime', async () => {
    const service = build(new ApiKeyServiceOptions('sk', 32, Duration.fromObject({ days: 7 })));
    const { key } = await service.create({ owner, name: 'k' });

    await expect(service.update(key.id, { expiresAt: DateTime.utc().plus({ days: 8 }) })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('lists active keys by default and inactive ones on request', async () => {
    const service = build();
    const { key } = await service.create({ owner, name: 'a' });
    await service.create({ owner, name: 'b' });
    await service.revoke(key.id);

    await expect(service.listForOwner(owner)).resolves.toHaveLength(1);
    await expect(service.listForOwner(owner, { includeInactive: true })).resolves.toHaveLength(2);
  });

  it('deletes without error when the id is unknown', async () => {
    await expect(build().delete('nope')).resolves.toBeUndefined();
  });
});
