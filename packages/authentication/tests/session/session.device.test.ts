import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { Logger } from '@maroonedsoftware/logger';
import { AuthenticationSessionService, AuthenticationSessionServiceOptions } from '../../src/authentication.session.service.js';
import { JwtProvider } from '../../src/providers/jwt.provider.js';
import { MAX_USER_AGENT_LENGTH, normaliseSessionDevice } from '../../src/helpers.js';
import type { AuthenticationSessionFactor } from '../../src/types.js';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const makeLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() }) as unknown as Logger;

/** A cache that actually stores, so a write and a later read go through serialise/deserialise. */
const makeCache = () => {
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

const factor: AuthenticationSessionFactor = {
  issuedAt: DateTime.utc(),
  authenticatedAt: DateTime.utc(),
  method: 'password',
  methodId: 'pw-1',
  kind: 'knowledge',
};

let cache: ReturnType<typeof makeCache>;
let logger: Logger;

const build = () =>
  new AuthenticationSessionService(
    new AuthenticationSessionServiceOptions('iss', 'aud', Duration.fromObject({ minutes: 15 })),
    cache,
    new JwtProvider(logger, privateKey),
  );

beforeEach(() => {
  vi.clearAllMocks();
  cache = makeCache();
  logger = makeLogger();
});

describe('normaliseSessionDevice', () => {
  it('keeps what it is given', () => {
    expect(normaliseSessionDevice({ ipAddress: '203.0.113.7', userAgent: 'curl/8', label: 'Chrome on macOS' })).toEqual({
      ipAddress: '203.0.113.7',
      userAgent: 'curl/8',
      label: 'Chrome on macOS',
    });
  });

  it('treats a blank user agent as absent, which is how both adapters report a missing header', () => {
    // Koa's ctx.get returns '' for a missing header and the Fastify plugin
    // defaults it to ''. Without this, every session records an empty string.
    expect(normaliseSessionDevice({ ipAddress: '203.0.113.7', userAgent: '' })).toEqual({ ipAddress: '203.0.113.7' });
    expect(normaliseSessionDevice({ ipAddress: '203.0.113.7', userAgent: '   ' })).toEqual({ ipAddress: '203.0.113.7' });
  });

  it('returns undefined rather than an empty block', () => {
    expect(normaliseSessionDevice(undefined)).toBeUndefined();
    expect(normaliseSessionDevice({})).toBeUndefined();
    expect(normaliseSessionDevice({ ipAddress: '', userAgent: '', label: '  ' })).toBeUndefined();
  });

  it('trims each field', () => {
    expect(normaliseSessionDevice({ ipAddress: '  203.0.113.7 ', label: ' Phone ' })).toEqual({ ipAddress: '203.0.113.7', label: 'Phone' });
  });

  it('clamps an unbounded user agent', () => {
    const long = 'a'.repeat(600);

    const result = normaliseSessionDevice({ userAgent: long });

    expect(result?.userAgent).toHaveLength(MAX_USER_AGENT_LENGTH);
    expect(MAX_USER_AGENT_LENGTH).toBe(512);
  });

  it('does not validate the IP address', () => {
    // Deliberate: a correct IPv4/IPv6 validator is more surface than this earns,
    // and an app writing to a typed column owns that check.
    expect(normaliseSessionDevice({ ipAddress: 'not-an-ip' })).toEqual({ ipAddress: 'not-an-ip' });
  });
});

describe('device metadata survives the cache round trip', () => {
  it('is still there on a later read', async () => {
    // The one test that matters. `serializeSession` is an explicit allowlist, so
    // a field missing from it is returned by createSession and gone by the next
    // request — a bug that only shows up on the second call.
    const service = build();
    const created = await service.createSession('user-1', {}, factor);
    const key = [...cache.store.keys()].find(k => k.startsWith('auth_session_') && !k.includes('subject'))!;
    const stored = JSON.parse(cache.store.get(key)!);
    cache.store.set(key, JSON.stringify({ ...stored, device: { ipAddress: '203.0.113.7', userAgent: 'curl/8' } }));

    const read = await service.getSession(created.sessionToken);

    expect(read?.device).toEqual({ ipAddress: '203.0.113.7', userAgent: 'curl/8' });
  });

  it('reads a session cached before the field existed without throwing', async () => {
    const service = build();
    const created = await service.createSession('user-1', {}, factor);
    const key = [...cache.store.keys()].find(k => k.startsWith('auth_session_') && !k.includes('subject'))!;
    const { device: _dropped, ...legacy } = JSON.parse(cache.store.get(key)!);
    cache.store.set(key, JSON.stringify(legacy));

    const read = await service.getSession(created.sessionToken);

    expect(read?.subject).toBe('user-1');
    expect(read?.device).toBeUndefined();
  });

  it('stores no device block when none was supplied', async () => {
    const service = build();

    const created = await service.createSession('user-1', {}, factor);

    expect(created.device).toBeUndefined();
    const key = [...cache.store.keys()].find(k => k.startsWith('auth_session_') && !k.includes('subject'))!;
    expect(JSON.parse(cache.store.get(key)!).device).toBeUndefined();
  });
});

describe('the write paths', () => {
  const device = { ipAddress: '203.0.113.7', userAgent: 'curl/8', label: 'Laptop' };

  it('records what createSession was given', async () => {
    const created = await build().createSession('user-1', {}, factor, undefined, device);

    expect(created.device).toEqual(device);
  });

  it('normalises on the way in', async () => {
    const created = await build().createSession('user-1', {}, factor, undefined, {
      ipAddress: ' 203.0.113.7 ',
      userAgent: '',
    });

    expect(created.device).toEqual({ ipAddress: '203.0.113.7' });
  });

  it('carries the device forward across a rotation', async () => {
    // A step-up happens on a live request, but the session's origin is where it
    // began — the same reason claims carry forward rather than being rebuilt.
    const service = build();
    const created = await service.createSession('user-1', {}, factor, undefined, device);

    const rotated = await service.rotateSession(created.sessionToken, { acr: 'high' });

    expect(rotated.session.sessionToken).not.toBe(created.sessionToken);
    expect(rotated.session.device).toEqual(device);
  });

  it('lets a rotation re-stamp the device when the caller supplies one', async () => {
    const service = build();
    const created = await service.createSession('user-1', {}, factor, undefined, device);

    const rotated = await service.rotateSession(created.sessionToken, {}, undefined, { ipAddress: '198.51.100.4' });

    expect(rotated.session.device).toEqual({ ipAddress: '198.51.100.4' });
  });

  it('does not blank the device when a rotation supplies an empty one', async () => {
    // `{ userAgent: '' }` normalises to nothing, and nothing means "not given",
    // so the original survives rather than being wiped by an adapter default.
    const service = build();
    const created = await service.createSession('user-1', {}, factor, undefined, device);

    const rotated = await service.rotateSession(created.sessionToken, {}, undefined, { userAgent: '' });

    expect(rotated.session.device).toEqual(device);
  });

  it('passes the device through createOrUpdateSession when it creates', async () => {
    const created = await build().createOrUpdateSession(undefined, 'user-1', {}, factor, undefined, device);

    expect(created.device).toEqual(device);
  });

  it('leaves an existing session alone when createOrUpdateSession updates', async () => {
    const service = build();
    const created = await service.createSession('user-1', {}, factor, undefined, device);

    // Updating a live session must not rewrite where it began.
    const updated = await service.createOrUpdateSession(created.sessionToken, 'user-1', { plan: 'pro' }, factor, undefined, {
      ipAddress: '198.51.100.4',
    });

    expect(updated.device).toEqual(device);
  });

  it('survives a rotation through the cache, not just in memory', async () => {
    const service = build();
    const created = await service.createSession('user-1', {}, factor, undefined, device);
    const rotated = await service.rotateSession(created.sessionToken);

    const read = await service.getSession(rotated.session.sessionToken);

    expect(read?.device).toEqual(device);
  });
});
