import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { Logger } from '@maroonedsoftware/logger';
import { AuthenticationSessionService, AuthenticationSessionServiceOptions } from '../../src/authentication.session.service.js';
import { JwtProvider } from '../../src/providers/jwt.provider.js';
import { AuditRecorder } from '../../src/audit/audit.recorder.js';
import { AuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';
import type { AuthenticationSessionFactor } from '../../src/types.js';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

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

/** Captures every event so a test can assert on types, envelopes, and payloads. */
const makeCapturingSink = () => {
  const events: AuthenticationAuditEvent[] = [];
  return { events, sink: { record: (e: AuthenticationAuditEvent) => void events.push(e) } as unknown as AuditSink };
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
let captured: ReturnType<typeof makeCapturingSink>;

const build = () => {
  const options = new AuthenticationSessionServiceOptions('iss', 'aud', Duration.fromObject({ minutes: 15 }), Duration.fromObject({ days: 30 }));
  return new AuthenticationSessionService(options, cache, new JwtProvider(logger, privateKey), new AuditRecorder(captured.sink));
};

const typesOf = () => captured.events.map(e => e.type);

beforeEach(() => {
  vi.clearAllMocks();
  cache = makeCache();
  logger = makeLogger();
  captured = makeCapturingSink();
});

describe('session lifecycle events', () => {
  it('records a creation with the factors and claims the session carries', async () => {
    const session = await build().createSession('user-1', { loginIp: '203.0.113.7' }, factor);

    expect(typesOf()).toEqual(['session.created']);
    expect(captured.events[0]).toMatchObject({
      type: 'session.created',
      category: 'session',
      outcome: 'success',
      actorId: 'user-1',
      data: {
        sessionToken: session.sessionToken,
        factors: [{ method: 'password', methodId: 'pw-1', kind: 'knowledge' }],
        claims: { loginIp: '203.0.113.7' },
      },
    });
  });

  it('passes claims through whole so a later event can recover login context', async () => {
    // Both ServerKit consumers stamp loginIp/loginUserAgent at login and read
    // them back on revoke, which happens on a different request.
    const service = build();
    const session = await service.createSession('user-1', { loginIp: '203.0.113.7', loginUserAgent: 'curl/8' }, factor);
    captured.events.length = 0;

    await service.deleteSession(session.sessionToken, 'logout');

    expect(captured.events[0]!.data).toMatchObject({ claims: { loginIp: '203.0.113.7', loginUserAgent: 'curl/8' } });
  });

  it('records an update as a privilege change', async () => {
    const service = build();
    const session = await service.createSession('user-1', {}, factor);
    captured.events.length = 0;

    await service.updateSession(session.sessionToken, 'user-1', undefined, { plan: 'pro' });

    // Claims are what a route's policy reads, so changing them changes what the
    // session may do.
    expect(captured.events[0]).toMatchObject({ type: 'session.updated', category: 'privilege', actorId: 'user-1' });
  });

  it('records a revocation with its reason', async () => {
    const service = build();
    const session = await service.createSession('user-1', {}, factor);
    captured.events.length = 0;

    await service.deleteSession(session.sessionToken, 'recovery');

    expect(captured.events[0]).toMatchObject({ type: 'session.revoked', actorId: 'user-1', data: { reason: 'recovery' } });
  });

  it('records a rotation as one event naming both tokens', async () => {
    const service = build();
    const session = await service.createSession('user-1', {}, factor);
    captured.events.length = 0;

    const rotated = await service.rotateSession(session.sessionToken);

    // One event naming both tokens, so a consumer never has to correlate two
    // records to see that one session replaced another.
    const rotation = captured.events.find(e => e.type === 'session.rotated');
    expect(rotation).toMatchObject({
      category: 'privilege',
      actorId: 'user-1',
      data: { previousSessionToken: session.sessionToken, sessionToken: rotated.session.sessionToken },
    });
  });

  it('records a bulk revocation with the count no hook ever sees', async () => {
    const service = build();
    await service.createSession('user-1', {}, factor);
    await service.createSession('user-1', {}, factor);
    captured.events.length = 0;

    await expect(service.revokeAllForSubject('user-1', 'recovery')).resolves.toBe(2);

    expect(captured.events.filter(e => e.type === 'session.revoked')).toHaveLength(2);
    expect(captured.events.find(e => e.type === 'session.revoked_all')).toMatchObject({
      actorId: 'user-1',
      data: { reason: 'recovery', count: 2 },
    });
  });

  it('records a bulk revocation of nothing without inventing sessions', async () => {
    await expect(build().revokeAllForSubject('nobody')).resolves.toBe(0);

    expect(captured.events).toMatchObject([{ type: 'session.revoked_all', data: { count: 0 } }]);
  });
});

describe('validation failures', () => {
  it('attributes an actor when the subject does not match', async () => {
    const service = build();
    const session = await service.createSession('user-1', {}, factor);
    const { accessToken } = await service.issueTokenForSession(session.sessionToken);
    // Corrupt the stored session's subject so the JWT no longer matches it.
    const key = [...cache.store.keys()].find(k => k.startsWith('auth_session_') && !k.includes('subject'))!;
    cache.store.set(key, cache.store.get(key)!.replace('"user-1"', '"someone-else"'));
    captured.events.length = 0;

    await expect(service.lookupSessionFromJwt(accessToken)).rejects.toThrow();

    // The hook passes only a token, forcing a consumer to look the session up
    // again. The event carries the actor the service already has.
    expect(captured.events[0]).toMatchObject({
      type: 'session.validation_failed',
      category: 'login',
      outcome: 'failure',
      actorId: 'someone-else',
      data: { reason: 'subject_mismatch' },
    });
  });

  it('attributes an actor from the token when the session is gone', async () => {
    const service = build();
    const session = await service.createSession('user-1', {}, factor);
    const { accessToken } = await service.issueTokenForSession(session.sessionToken);
    await service.deleteSession(session.sessionToken);
    captured.events.length = 0;

    await expect(service.lookupSessionFromJwt(accessToken)).rejects.toThrow();

    expect(captured.events[0]).toMatchObject({ type: 'session.validation_failed', actorId: 'user-1', data: { reason: 'session_not_found' } });
  });

  it('records an undecodable token with no actor, since there is none to attribute', async () => {
    await expect(build().lookupSessionFromJwt('not-a-jwt')).rejects.toThrow();

    expect(captured.events[0]).toMatchObject({ type: 'session.validation_failed', data: { reason: 'jwt_decode_failed' } });
    expect(captured.events[0]!.actorId).toBeUndefined();
  });

  it('records an unusable refresh token', async () => {
    await expect(build().refreshSession('nonsense')).rejects.toThrow();

    expect(captured.events[0]).toMatchObject({ type: 'session.validation_failed', data: { reason: 'refresh_token_invalid' } });
  });
});

describe('refresh and theft', () => {
  it('records a refresh naming the token it replaced', async () => {
    const service = build();
    const session = await service.createSession('user-1', {}, factor);
    const { refreshToken } = await service.issueTokenForSession(session.sessionToken);
    captured.events.length = 0;

    await service.refreshSession(refreshToken!);

    expect(captured.events[0]).toMatchObject({ type: 'session.refreshed', actorId: 'user-1', data: { previousJti: expect.any(String) } });
  });

  it('records a replayed refresh token as a failure, with the family teardown and its count', async () => {
    const service = build();
    const session = await service.createSession('user-1', {}, factor);
    const { refreshToken } = await service.issueTokenForSession(session.sessionToken);
    await service.refreshSession(refreshToken!);
    captured.events.length = 0;

    await expect(service.refreshSession(refreshToken!)).rejects.toThrow();

    expect(captured.events.find(e => e.type === 'session.refresh_reuse_detected')).toMatchObject({ category: 'login', outcome: 'failure' });
    expect(captured.events.find(e => e.type === 'session.family_revoked')).toMatchObject({ data: { count: expect.any(Number) } });
  });
});

describe('the sink is the only lifecycle seam', () => {
  it('reports every lifecycle transition through one channel', async () => {
    const service = build();
    const session = await service.createSession('user-1', {}, factor);
    const { refreshToken } = await service.issueTokenForSession(session.sessionToken);
    await service.refreshSession(refreshToken!);
    await service.deleteSession(session.sessionToken);
    await expect(service.lookupSessionFromJwt('bad')).rejects.toThrow();

    // What five separate hook callbacks used to cover.
    expect(typesOf()).toEqual(['session.created', 'session.refreshed', 'session.revoked', 'session.validation_failed']);
  });

  it('completes the operation when the sink throws', async () => {
    const service = new AuthenticationSessionService(
      new AuthenticationSessionServiceOptions('iss', 'aud', Duration.fromObject({ minutes: 15 })),
      cache,
      new JwtProvider(logger, privateKey),
      new AuditRecorder(
        {
          record: () => {
            throw new Error('sink down');
          },
        } as unknown as AuditSink,
        undefined,
        logger,
      ),
    );

    // An audit outage must not become a login outage.
    await expect(service.createSession('user-1', {}, factor)).resolves.toMatchObject({ subject: 'user-1' });
    expect(logger.error).toHaveBeenCalledWith('audit.sink_failed', expect.objectContaining({ type: 'session.created' }));
  });
});
