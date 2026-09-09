import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Duration } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import type { EncryptionProvider } from '@maroonedsoftware/encryption';
import type { PolicyService } from '@maroonedsoftware/policies';
import { EmailFactorService, EmailFactorServiceOptions } from '../../src/factors/email/email.factor.service.js';
import type { EmailFactorRepository } from '../../src/factors/email/email.factor.repository.js';
import { PhoneFactorService, PhoneFactorServiceOptions } from '../../src/factors/phone/phone.factor.service.js';
import type { PhoneFactorRepository } from '../../src/factors/phone/phone.factor.repository.js';
import { AuthenticatorFactorService, AuthenticatorFactorServiceOptions } from '../../src/factors/authenticator/authenticator.factor.service.js';
import type { AuthenticatorFactorRepository } from '../../src/factors/authenticator/authenticator.factor.repository.js';
import { OtpProvider } from '../../src/providers/otp.provider.js';
import { AuditRecorder } from '../../src/audit/audit.recorder.js';
import { AuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';

let events: AuthenticationAuditEvent[];
const sink = () => ({ record: (e: AuthenticationAuditEvent) => void events.push(e) }) as unknown as AuditSink;

const makeCache = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    add: vi.fn(async (k: string, v: string) => (store.has(k) ? false : (store.set(k, v), true))),
    update: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    delete: vi.fn(async (k: string) => (store.delete(k) ? k : null)),
  } as unknown as CacheProvider & { store: Map<string, string> };
};

const allowAll = () => ({ check: vi.fn(async () => ({ allowed: true })), assert: vi.fn(async () => undefined) }) as unknown as PolicyService;

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
});

describe('email factor events', () => {
  const emailFactor = { id: 'ef-1', actorId: 'user-1', value: 'a@example.com', active: true };

  const build = (cache = makeCache()) => {
    const repository = {
      getFactor: vi.fn(async () => emailFactor),
      findFactor: vi.fn(async () => emailFactor),
      createFactor: vi.fn(async () => emailFactor),
      deleteFactor: vi.fn(async () => undefined),
      listFactors: vi.fn(async () => [emailFactor]),
      isDomainInviteOnly: vi.fn(async () => false),
    } as unknown as EmailFactorRepository;
    return {
      service: new EmailFactorService(new EmailFactorServiceOptions(), repository, new OtpProvider(), cache, allowAll(), new AuditRecorder(sink())),
      cache,
    };
  };

  it('records an issued challenge without the code it dispatched', async () => {
    const { service } = build();

    const issued = await service.issueEmailChallenge('user-1', 'ef-1', 'code');

    expect(events).toMatchObject([
      { type: 'email.challenge.issued', category: 'login', actorId: 'user-1', data: { factorId: 'ef-1', issueMethod: 'code', alreadyIssued: false } },
    ]);
    // The service hands the caller the code for delivery; the event must not.
    expect(JSON.stringify(events)).not.toContain(issued.code);
  });

  it('records a verified challenge as a login', async () => {
    const { service } = build();
    const issued = await service.issueEmailChallenge('user-1', 'ef-1', 'code');
    events.length = 0;

    await service.verifyEmailChallenge(issued.challengeId, issued.code!);

    expect(events).toMatchObject([{ type: 'email.challenge.verified', category: 'login', outcome: 'success', actorId: 'user-1' }]);
    expect(JSON.stringify(events)).not.toContain(issued.code);
  });

  it('records a wrong code and, after enough of them, a locked challenge', async () => {
    const { service } = build();
    const issued = await service.issueEmailChallenge('user-1', 'ef-1', 'code');
    events.length = 0;

    for (let i = 0; i < 5; i++) {
      await service.verifyEmailChallenge(issued.challengeId, '000000').catch(() => undefined);
    }

    expect(events.filter(e => e.type === 'email.challenge.failed').length).toBeGreaterThan(0);
    expect(events.find(e => e.type === 'email.challenge.locked')).toMatchObject({ outcome: 'failure', data: { attempts: expect.any(Number) } });
  });

  it('records an unknown challenge without attributing an actor', async () => {
    const { service } = build();

    await expect(service.verifyEmailChallenge('nope', '000000')).rejects.toThrow();

    expect(events[0]).toMatchObject({ type: 'email.challenge.failed', data: { reason: 'challenge_not_found' } });
    expect(events[0]!.actorId).toBeUndefined();
  });

  it('records a cross-method probe under its real reason', async () => {
    const { service } = build();
    const issued = await service.issueEmailChallenge('user-1', 'ef-1', 'code');
    events.length = 0;

    await expect(service.verifyEmailChallenge(issued.challengeId, issued.code!, 'magiclink')).rejects.toThrow();

    // The caller is told "not found" to avoid revealing state; the audit trail
    // records what actually happened.
    expect(events[0]).toMatchObject({ type: 'email.challenge.failed', data: { reason: 'method_mismatch' } });
  });

  it('never records a magic link token', async () => {
    const { service } = build();

    const issued = await service.issueEmailChallenge('user-1', 'ef-1', 'magiclink');
    await service.verifyEmailChallenge(issued.challengeId, issued.code!, 'magiclink');

    expect(JSON.stringify(events)).not.toContain(issued.code);
  });
});

describe('phone factor events', () => {
  const phoneFactor = { id: 'pf-1', actorId: 'user-1', value: '+15550001111', active: true };

  const build = () => {
    const repository = {
      getFactor: vi.fn(async () => phoneFactor),
      createFactor: vi.fn(async () => phoneFactor),
      deleteFactor: vi.fn(async () => undefined),
      listFactors: vi.fn(async () => [phoneFactor]),
    } as unknown as PhoneFactorRepository;
    return new PhoneFactorService(new PhoneFactorServiceOptions(), repository, new OtpProvider(), makeCache(), allowAll(), new AuditRecorder(sink()));
  };

  it('records issue and verify without the code', async () => {
    const service = build();

    const issued = await service.issuePhoneChallenge('user-1', 'pf-1');
    await service.verifyPhoneChallenge(issued.challengeId, issued.code!);

    expect(events.map(e => e.type)).toEqual(['phone.challenge.issued', 'phone.challenge.verified']);
    expect(JSON.stringify(events)).not.toContain(issued.code);
  });

  it('records a factor removal', async () => {
    await build().deleteFactor('user-1', 'pf-1');

    expect(events).toMatchObject([{ type: 'phone.factor.deleted', category: 'credential', actorId: 'user-1', data: { factorId: 'pf-1' } }]);
  });
});

describe('authenticator factor events', () => {
  const build = (cache = makeCache()) => {
    let counter = 0;
    const factor = {
      id: 'af-1',
      actorId: 'user-1',
      active: true,
      type: 'totp' as const,
      secretHash: 'enc:SECRET',
      periodSeconds: 30,
      tokenLength: 6,
      counter: 0,
    };
    const repository = {
      getFactor: vi.fn(async () => factor),
      createFactor: vi.fn(async () => factor),
      deleteFactor: vi.fn(async () => undefined),
      updateFactorCounter: vi.fn(async () => void counter++),
      listFactors: vi.fn(async () => [factor]),
      lookupFactor: vi.fn(async () => undefined),
    } as unknown as AuthenticatorFactorRepository;
    const encryption = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.replace(/^enc:/, '') } as unknown as EncryptionProvider;
    return new AuthenticatorFactorService(
      new AuthenticatorFactorServiceOptions('ServerKit'),
      new OtpProvider(),
      repository,
      encryption,
      cache,
      new AuditRecorder(sink()),
    );
  };

  it('records a registration without the secret, URI, or QR code', async () => {
    const registration = await build().registerAuthenticatorFactor('user-1', 'Phone');

    expect(events).toMatchObject([{ type: 'authenticator.registered', category: 'credential', actorId: 'user-1', data: { label: 'Phone' } }]);

    // All three carry the secret.
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(registration.secret);
    expect(serialised).not.toContain(registration.uri);
    expect(serialised).not.toContain(registration.qrCode);
  });

  it('records a wrong code and a rate limit distinctly', async () => {
    const cache = makeCache();
    const service = build(cache);

    await expect(service.validateFactor('user-1', 'af-1', '000000')).rejects.toThrow();
    expect(events).toMatchObject([{ type: 'authenticator.validation.failed', data: { reason: 'invalid_code' } }]);

    events = [];
    cache.store.set('authenticator_factor_attempts_user-1_af-1', '5');
    await expect(service.validateFactor('user-1', 'af-1', '000000')).rejects.toMatchObject({ statusCode: 429 });
    expect(events).toMatchObject([{ type: 'authenticator.validation.rate_limited' }]);
  });

  it('records a removal as a privilege change', async () => {
    await build().deleteFactor('user-1', 'af-1');

    // An auditor cares about an MFA factor disappearing as much as one appearing.
    expect(events).toMatchObject([{ type: 'authenticator.factor.deleted', category: 'privilege', actorId: 'user-1' }]);
  });
});
