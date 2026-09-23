import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import jsonwebtoken from 'jsonwebtoken';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { Logger } from '@maroonedsoftware/logger';
import { AuthenticationSessionService, AuthenticationSessionServiceOptions } from '../../src/authentication.session.service.js';
import { JwtProvider } from '../../src/providers/jwt.provider.js';
import { AuditRecorder } from '../../src/audit/audit.recorder.js';
import { AuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';
import type { AuthenticationSessionFactor } from '../../src/types.js';
import { generateKeyPairSync } from 'node:crypto';

/**
 * A session can carry its own audience: every token it issues is minted for it,
 * and only a validation that asks for it accepts them. These tests use a real
 * JwtProvider so `aud` is genuinely signed and verified.
 */

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const DEFAULT_AUDIENCE = 'console';
const RESOURCE = 'https://station.example.com/api/mcp';

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

const makeLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const factor: AuthenticationSessionFactor = {
  issuedAt: DateTime.utc(),
  authenticatedAt: DateTime.utc(),
  method: 'password',
  methodId: 'pw-1',
  kind: 'knowledge',
};

let cache: ReturnType<typeof makeCache>;
let events: AuthenticationAuditEvent[];
let service: AuthenticationSessionService;

const audOf = (token: string) => (jsonwebtoken.decode(token) as { aud?: string | string[] }).aud;
const failureReasons = () =>
  events.filter(event => event.type === 'session.validation_failed').map(event => (event.data as { reason: string }).reason);

beforeEach(() => {
  cache = makeCache();
  events = [];
  const options = new AuthenticationSessionServiceOptions(
    'issuer',
    DEFAULT_AUDIENCE,
    Duration.fromObject({ minutes: 15 }),
    Duration.fromObject({ days: 30 }),
  );
  const recorder = new AuditRecorder({ record: (event: AuthenticationAuditEvent) => void events.push(event) } as unknown as AuditSink);
  service = new AuthenticationSessionService(options, cache, new JwtProvider(makeLogger(), privateKey), recorder);
});

describe('a session with its own audience', () => {
  it('keeps the audience across the cache boundary and reports it on the created event', async () => {
    const created = await service.createSession('user-1', {}, factor, undefined, undefined, RESOURCE);

    expect(created.audience).toBe(RESOURCE);
    expect((await service.getSession(created.sessionToken))?.audience).toBe(RESOURCE);
    expect(events.find(event => event.type === 'session.created')).toMatchObject({ data: { audience: RESOURCE } });
  });

  it('mints both its access and refresh tokens for that audience', async () => {
    const session = await service.createSession('user-1', {}, factor, undefined, undefined, RESOURCE);

    const { accessToken, refreshToken } = await service.issueTokenForSession(session.sessionToken);

    expect(audOf(accessToken)).toBe(RESOURCE);
    expect(audOf(refreshToken!)).toBe(RESOURCE);
  });

  it('carries the audience across a rotation', async () => {
    const session = await service.createSession('user-1', {}, factor, undefined, undefined, RESOURCE);

    const rotated = await service.rotateSession(session.sessionToken, { stepUp: true });

    expect(rotated.session.audience).toBe(RESOURCE);
    expect(audOf(rotated.accessToken)).toBe(RESOURCE);
    expect((await service.getSession(rotated.session.sessionToken))?.audience).toBe(RESOURCE);
  });

  it('keeps the audience when the session is updated in place', async () => {
    const session = await service.createSession('user-1', {}, factor, undefined, undefined, RESOURCE);

    await service.updateSession(session.sessionToken, 'user-1', undefined, { later: true });

    expect((await service.getSession(session.sessionToken))?.audience).toBe(RESOURCE);
  });

  it('is refused by a lookup that does not ask for its audience', async () => {
    const session = await service.createSession('user-1', {}, factor, undefined, undefined, RESOURCE);
    const { accessToken } = await service.issueTokenForSession(session.sessionToken);
    vi.mocked(cache.get).mockClear();

    await expect(service.lookupSessionFromJwt(accessToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.lookupSessionFromJwt(accessToken, false, 'somewhere-else')).rejects.toMatchObject({ statusCode: 401 });

    expect(cache.get).not.toHaveBeenCalled();
    expect(failureReasons()).toEqual(['audience_mismatch', 'audience_mismatch']);
  });

  it('is accepted by a lookup that asks for its audience', async () => {
    const session = await service.createSession('user-1', {}, factor, undefined, undefined, RESOURCE);
    const { accessToken } = await service.issueTokenForSession(session.sessionToken);

    const found = await service.lookupSessionFromJwt(accessToken, false, RESOURCE);

    expect(found.session.sessionToken).toBe(session.sessionToken);
  });

  it('refreshes only where its audience is expected', async () => {
    const session = await service.createSession('user-1', {}, factor, undefined, undefined, RESOURCE);
    const { refreshToken } = await service.issueTokenForSession(session.sessionToken);

    await expect(service.refreshSession(refreshToken!)).rejects.toMatchObject({ statusCode: 401 });
    const refreshed = await service.refreshSession(refreshToken!, [RESOURCE]);

    expect(audOf(refreshed.accessToken)).toBe(RESOURCE);
  });
});

describe('a session with the default audience', () => {
  it('stores no audience of its own and mints for the service default', async () => {
    const session = await service.createSession('user-1', {}, factor);
    const { accessToken } = await service.issueTokenForSession(session.sessionToken);

    expect('audience' in session).toBe(false);
    expect(audOf(accessToken)).toBe(DEFAULT_AUDIENCE);
  });

  it('is refused by a lookup that asks for a resource audience', async () => {
    const session = await service.createSession('user-1', {}, factor);
    const { accessToken } = await service.issueTokenForSession(session.sessionToken);

    await expect(service.lookupSessionFromJwt(accessToken, false, RESOURCE)).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.lookupSessionFromJwt(accessToken)).resolves.toBeDefined();
  });

  it('accepts a session cached before sessions had an audience', async () => {
    const session = await service.createSession('user-1', {}, factor);
    const key = `auth_session_${session.sessionToken}`;
    const legacy = JSON.parse(cache.store.get(key)!);
    delete legacy.audience;
    cache.store.set(key, JSON.stringify(legacy));

    const { accessToken } = await service.issueTokenForSession(session.sessionToken);

    expect(audOf(accessToken)).toBe(DEFAULT_AUDIENCE);
    await expect(service.lookupSessionFromJwt(accessToken)).resolves.toBeDefined();
  });
});

describe('a refresh token presented as an access token', () => {
  it('is refused and recorded, before the session is read', async () => {
    const session = await service.createSession('user-1', {}, factor);
    const { refreshToken } = await service.issueTokenForSession(session.sessionToken);
    vi.mocked(cache.get).mockClear();

    await expect(service.lookupSessionFromJwt(refreshToken!)).rejects.toMatchObject({ statusCode: 401 });

    expect(cache.get).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: 'session.validation_failed',
      actorId: 'user-1',
      data: { sessionToken: session.sessionToken, reason: 'refresh_token_presented' },
    });
  });
});
