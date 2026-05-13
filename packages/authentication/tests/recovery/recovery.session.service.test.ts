import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime, Duration } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { RecoverySessionService, RecoverySessionServiceOptions } from '../../src/recovery/recovery.session.service.js';
import { AuthenticationSessionService, AuthenticationSessionServiceOptions } from '../../src/authentication.session.service.js';
import type { JwtProvider } from '../../src/providers/jwt.provider.js';
import type { Logger } from '@maroonedsoftware/logger';

const makeCache = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
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

const actor = { kind: 'user', actorId: 'user-1' };

describe('RecoverySessionService', () => {
  let cache: ReturnType<typeof makeCache>;
  let service: RecoverySessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCache();
    service = new RecoverySessionService(new RecoverySessionServiceOptions(), cache);
  });

  it('issues a session with an opaque token, grants, and timestamps', async () => {
    const session = await service.issue({
      actor,
      reason: 'password_reset',
      verifiedVia: { channel: 'email', methodId: 'email-1' },
      grantedActions: ['resetPassword'],
    });

    expect(session.recoverySessionToken).toBeTruthy();
    expect(session.grantedActions).toEqual(['resetPassword']);
    expect(session.issuedAt).toBeInstanceOf(DateTime);
    expect(session.expiresAt).toBeInstanceOf(DateTime);
  });

  it('redeem returns the payload and deletes it — single-use', async () => {
    const session = await service.issue({
      actor,
      reason: 'password_reset',
      verifiedVia: { channel: 'email', methodId: 'email-1' },
      grantedActions: ['resetPassword'],
    });

    const redeemed = await service.redeem(session.recoverySessionToken);
    expect(redeemed?.recoverySessionToken).toBe(session.recoverySessionToken);

    expect(await service.peek(session.recoverySessionToken)).toBeNull();
    expect(await service.redeem(session.recoverySessionToken)).toBeNull();
  });

  it('peek returns null for an unknown token', async () => {
    expect(await service.peek('does-not-exist')).toBeNull();
  });

  it('does not expose a JWT issuance method — recovery tokens cannot become access tokens', () => {
    // Structural assertion. If anyone adds a JWT-emitting method to
    // RecoverySessionService, this test should be updated to reflect that and
    // the security review redone — recovery tokens are intentionally opaque.
    expect((service as unknown as Record<string, unknown>).issueTokenForSession).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).createToken).toBeUndefined();
  });

  it('a recovery session token cannot be resolved through AuthenticationSessionService', async () => {
    const session = await service.issue({
      actor,
      reason: 'password_reset',
      verifiedVia: { channel: 'email', methodId: 'email-1' },
      grantedActions: ['resetPassword'],
    });

    // Both services share the cache abstraction; ensure the key prefix isolation
    // structurally prevents the recovery session from authorizing app endpoints.
    const authOptions = new AuthenticationSessionServiceOptions(
      'https://auth.example.com',
      'https://api.example.com',
      Duration.fromObject({ hours: 1 }),
    );
    const authService = new AuthenticationSessionService(
      authOptions,
      cache,
      { create: vi.fn(), decode: vi.fn() } as unknown as JwtProvider,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
    );

    expect(await authService.getSession(session.recoverySessionToken)).toBeUndefined();
    expect(cache.store.has(`auth_session_${session.recoverySessionToken}`)).toBe(false);
    expect(cache.store.has(`recovery_session_${session.recoverySessionToken}`)).toBe(true);
  });
});
