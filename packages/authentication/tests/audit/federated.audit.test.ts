import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheProvider } from '@maroonedsoftware/cache';
import type { EncryptionProvider } from '@maroonedsoftware/encryption';
import type { Logger } from '@maroonedsoftware/logger';
import type { PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { OAuth2FactorService, OAuth2FactorServiceOptions } from '../../src/factors/oauth2/oauth2.factor.service.js';
import type { OAuth2FactorRepository } from '../../src/factors/oauth2/oauth2.factor.repository.js';
import type { OAuth2ActorEmailLookup } from '../../src/factors/oauth2/oauth2.factor.service.js';
import type { OAuth2ProviderRegistry } from '../../src/providers/oauth2.provider.js';
import { AuditRecorder } from '../../src/audit/audit.recorder.js';
import { AuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';

const ACCESS_TOKEN = 'at_supersecret_value';
const REFRESH_TOKEN = 'rt_supersecret_value';

let events: AuthenticationAuditEvent[];
let existingFactor: { id: string; actorId: string; provider: string; subject: string; email?: string; picture?: string } | undefined;
let matchedActorId: string | undefined;
let policyResult: PolicyResult;
let emailVerified: boolean;
let storedState: Record<string, unknown> | undefined;

const makeCache = () => {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => (k.startsWith('oauth2_state_') ? (storedState ? JSON.stringify(storedState) : null) : (store.get(k) ?? null))),
    set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    add: vi.fn(async () => true),
    update: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    delete: vi.fn(async (k: string) => (store.delete(k) ? k : null)),
  } as unknown as CacheProvider;
};

const build = () => {
  const sink = { record: (e: AuthenticationAuditEvent) => void events.push(e) } as unknown as AuditSink;
  const registry = {
    getConfig: vi.fn(() => ({
      persistRefreshToken: true,
      redirectUri: new URL('https://app.example.com/cb'),
      usesPKCE: false,
      client: {
        validateAuthorizationCode: vi.fn(async () => ({ accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN, expiresAt: undefined })),
        refreshAccessToken: vi.fn(),
        createAuthorizationURL: vi.fn(() => new URL('https://provider.example.com/authorize')),
      },
      fetchProfile: vi.fn(async () => ({ subject: 'sub-1', email: 'a@example.com', emailVerified, name: 'A' })),
    })),
  } as unknown as OAuth2ProviderRegistry;

  const repo = {
    findFactor: vi.fn(async () => existingFactor),
    createFactor: vi.fn(async (actorId: string) => ({ id: 'of-1', actorId, provider: 'github', subject: 'sub-1' })),
    updateRefreshToken: vi.fn(async () => undefined),
    updateEmail: vi.fn(async () => undefined),
    updatePicture: vi.fn(async () => undefined),
    deleteFactor: vi.fn(async () => undefined),
    lookupFactorsByEmail: vi.fn(async () => []),
  } as unknown as OAuth2FactorRepository;

  return new OAuth2FactorService(
    new OAuth2FactorServiceOptions(),
    registry,
    repo,
    { findActorByEmail: vi.fn(async () => matchedActorId) } as unknown as OAuth2ActorEmailLookup,
    makeCache(),
    { encryptWithNewDek: () => ({ encryptedValue: 'enc', encryptedDek: 'dek' }) } as unknown as EncryptionProvider,
    { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger,
    { check: vi.fn(async () => policyResult), assert: vi.fn(async () => undefined) } as unknown as PolicyService,
    new AuditRecorder(sink),
  );
};

const callback = { params: { state: 'st-1', code: 'code-1' } };

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  existingFactor = undefined;
  matchedActorId = undefined;
  policyResult = { allowed: true };
  emailVerified = false;
  storedState = { provider: 'github', state: 'st-1', issuedAt: 0, expiresAt: 9999999999 };
});

describe('federated authorization outcomes', () => {
  it('records a sign-in against an existing identity', async () => {
    existingFactor = { id: 'of-1', actorId: 'user-1', provider: 'github', subject: 'sub-1' };

    await build().completeAuthorization(callback);

    expect(events).toMatchObject([
      { type: 'oauth2.signed_in', category: 'login', outcome: 'success', actorId: 'user-1', data: { provider: 'github', subject: 'sub-1' } },
    ]);
  });

  it('records an explicit link as a privilege change', async () => {
    storedState = { ...storedState, intent: 'link', actorId: 'user-1' };

    await build().completeAuthorization(callback);

    expect(events).toMatchObject([{ type: 'oauth2.linked.explicit', category: 'privilege', actorId: 'user-1' }]);
  });

  it('records an auto-link on a verified email, the takeover-adjacent path', async () => {
    emailVerified = true;
    matchedActorId = 'user-1';

    await build().completeAuthorization(callback);

    // Anyone who can get a provider to assert a verified address gains this
    // account, so the join is recorded with everything needed to review it.
    expect(events).toMatchObject([
      {
        type: 'oauth2.linked.auto',
        category: 'privilege',
        actorId: 'user-1',
        data: { provider: 'github', subject: 'sub-1', email: 'a@example.com' },
      },
    ]);
  });

  it('records a genuinely new user', async () => {
    await build().completeAuthorization(callback);

    expect(events).toMatchObject([{ type: 'oauth2.new_user', category: 'login', data: { provider: 'github', subject: 'sub-1' } }]);
  });

  it('records a missing or unknown state', async () => {
    await expect(build().completeAuthorization({ params: { code: 'c' } })).rejects.toThrow();
    expect(events).toMatchObject([{ type: 'oauth2.authorization.failed', outcome: 'failure', data: { reason: 'state_invalid' } }]);

    events = [];
    storedState = undefined;
    await expect(build().completeAuthorization(callback)).rejects.toThrow();
    expect(events).toMatchObject([{ type: 'oauth2.authorization.failed', data: { reason: 'state_invalid' } }]);
  });

  it('records a provider-returned error', async () => {
    await expect(build().completeAuthorization({ params: { error: 'access_denied' } })).rejects.toThrow();

    expect(events).toMatchObject([{ type: 'oauth2.authorization.failed', data: { reason: 'provider_error' } }]);
  });

  it('records a policy refusal with the provider and subject', async () => {
    policyResult = { allowed: false, reason: 'domain_not_allowed' };

    await expect(build().completeAuthorization(callback)).rejects.toMatchObject({ statusCode: 403 });

    expect(events).toMatchObject([{ type: 'oauth2.authorization.failed', data: { reason: 'policy_denied', provider: 'github', subject: 'sub-1' } }]);
  });

  it('never records an access or refresh token', async () => {
    existingFactor = { id: 'of-1', actorId: 'user-1', provider: 'github', subject: 'sub-1' };
    const service = build();

    await service.beginAuthorization({ provider: 'github', intent: 'sign-in' });
    await service.completeAuthorization(callback);

    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(ACCESS_TOKEN);
    expect(serialised).not.toContain(REFRESH_TOKEN);
  });

  it('records the start of an authorization', async () => {
    await build().beginAuthorization({ provider: 'github', intent: 'sign-in' });

    expect(events).toMatchObject([{ type: 'oauth2.authorization.begun', category: 'login', data: { provider: 'github' } }]);
  });
});
