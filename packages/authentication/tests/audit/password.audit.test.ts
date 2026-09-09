import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateLimiterCompatibleAbstract } from 'rate-limiter-flexible';
import type { CacheProvider } from '@maroonedsoftware/cache';
import type { PolicyService } from '@maroonedsoftware/policies';
import { PasswordFactorService } from '../../src/factors/password/password.factor.service.js';
import type { PasswordFactor, PasswordFactorRepository } from '../../src/factors/password/password.factor.repository.js';
import type { PasswordStrengthProvider } from '../../src/providers/password.strength.provider.js';
import type { PasswordHashProvider } from '../../src/providers/password.hash.provider.js';
import { AuditRecorder } from '../../src/audit/audit.recorder.js';
import { AuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';

const PASSWORD = 'correct horse battery staple';

const makeHashProvider = () =>
  ({
    hash: vi.fn(async (p: string) => ({ hash: `hashed:${p}`, salt: 'salt' })),
    verify: vi.fn(async (p: string, hash: string) => `hashed:${p}` === hash),
  }) as unknown as PasswordHashProvider;

const makeRateLimiter = () =>
  ({
    consume: vi.fn().mockResolvedValue(undefined),
    reward: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }) as unknown as RateLimiterCompatibleAbstract;

const makeStrength = () =>
  ({ ensureStrength: vi.fn(async () => undefined), checkStrength: vi.fn(async () => ({ score: 4 })) }) as unknown as PasswordStrengthProvider;
const makePolicyService = () => ({ check: vi.fn(async () => ({ allowed: true })), assert: vi.fn(async () => undefined) }) as unknown as PolicyService;
const makeCache = () => {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    add: vi.fn(async () => true),
    update: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    delete: vi.fn(async (k: string) => (store.delete(k) ? k : null)),
  } as unknown as CacheProvider;
};

const factor = (over: Partial<PasswordFactor> = {}): PasswordFactor =>
  ({
    id: 'pw-1',
    actorId: 'user-1',
    active: true,
    needsReset: false,
    value: { hash: `hashed:${PASSWORD}`, salt: 'salt' },
    hash: `hashed:${PASSWORD}`,
    salt: 'salt',
    ...over,
  }) as PasswordFactor;

let stored: PasswordFactor | undefined;
let rateLimiter: RateLimiterCompatibleAbstract;
let events: AuthenticationAuditEvent[];

const makeRepository = () =>
  ({
    getFactor: vi.fn(async () => stored),
    createFactor: vi.fn(async () => factor()),
    updateFactor: vi.fn(async () => factor()),
    deleteFactor: vi.fn(async () => undefined),
    listPreviousPasswords: vi.fn(async () => []),
    listFactors: vi.fn(async () => []),
  }) as unknown as PasswordFactorRepository;

const build = () => {
  const sink = { record: (e: AuthenticationAuditEvent) => void events.push(e) } as unknown as AuditSink;
  return new PasswordFactorService(
    makeRepository(),
    rateLimiter,
    makeStrength(),
    makeHashProvider(),
    makePolicyService(),
    makeCache(),
    new AuditRecorder(sink),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  rateLimiter = makeRateLimiter();
  stored = factor();
});

describe("password verification, the package's most important event", () => {
  it('records a success with the factor that authenticated', async () => {
    await build().verifyPassword('user-1', PASSWORD);

    expect(events).toMatchObject([
      { type: 'password.verify.succeeded', category: 'login', outcome: 'success', actorId: 'user-1', data: { factorId: 'pw-1' } },
    ]);
  });

  it('records a wrong password', async () => {
    await expect(build().verifyPassword('user-1', 'wrong')).rejects.toThrow();

    expect(events).toMatchObject([{ type: 'password.verify.failed', outcome: 'failure', data: { reason: 'invalid_password', factorId: 'pw-1' } }]);
  });

  it('distinguishes a rate limit from a wrong password', async () => {
    (rateLimiter.consume as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('limited'));

    await expect(build().verifyPassword('user-1', PASSWORD)).rejects.toMatchObject({ statusCode: 429 });

    // Its own type, not a verify.failed reason: a wrong password is one person
    // mistyping, a burst of these is the lockout signal.
    expect(events).toMatchObject([{ type: 'password.verify.rate_limited', category: 'login', outcome: 'failure', actorId: 'user-1' }]);
  });

  it('records a missing or deactivated factor', async () => {
    stored = undefined;

    await expect(build().verifyPassword('user-1', PASSWORD)).rejects.toThrow();
    expect(events).toMatchObject([{ type: 'password.verify.failed', data: { reason: 'no_active_factor' } }]);

    events = [];
    stored = factor({ active: false });
    await expect(build().verifyPassword('user-1', PASSWORD)).rejects.toThrow();
    expect(events).toMatchObject([{ type: 'password.verify.failed', data: { reason: 'no_active_factor' } }]);
  });

  it('records a forced reset separately from a wrong password', async () => {
    stored = factor({ needsReset: true });

    await expect(build().verifyPassword('user-1', PASSWORD)).rejects.toThrow();

    expect(events).toMatchObject([{ type: 'password.verify.failed', data: { reason: 'reset_required', factorId: 'pw-1' } }]);
  });

  it('never records the password itself', async () => {
    const service = build();
    await service.verifyPassword('user-1', PASSWORD);
    await expect(service.verifyPassword('user-1', 'hunter2')).rejects.toThrow();

    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('hashed:');
  });
});

describe('password credential changes', () => {
  it('records a first-time password as a credential change', async () => {
    stored = undefined;

    await build().createPasswordFactor('user-1', PASSWORD);

    expect(events).toMatchObject([{ type: 'password.created', category: 'credential', actorId: 'user-1', data: { needsReset: false } }]);
  });

  it('records a self-service change and a recovery reset as different events', async () => {
    const service = build();

    await service.updatePasswordFactor('user-1', PASSWORD);
    await service.changePassword('user-1', PASSWORD);

    // changePassword is the recovery path's credential change; updatePasswordFactor
    // is the actor changing their own, checked against history.
    expect(events.map(e => e.type)).toEqual(['password.updated', 'password.changed']);
  });

  it('records a removal', async () => {
    await build().deleteFactor('user-1');

    expect(events).toMatchObject([{ type: 'password.deleted', category: 'credential', actorId: 'user-1' }]);
  });

  it('records a cleared lockout as a privilege change', async () => {
    await build().clearRateLimit('user-1');

    // "Who unlocked this account" is a question about this event.
    expect(events).toMatchObject([{ type: 'password.rate_limit_cleared', category: 'privilege', actorId: 'user-1' }]);
  });
});
