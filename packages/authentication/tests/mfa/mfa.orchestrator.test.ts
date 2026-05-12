import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime, Duration } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { isPolicyResultDenied, PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { MfaOrchestrator } from '../../src/mfa/mfa.orchestrator.js';
import { MfaChallengeService, MfaChallengeServiceOptions } from '../../src/mfa/mfa.challenge.service.js';
import { AuthenticationSessionService, AuthenticationSessionServiceOptions } from '../../src/authentication.session.service.js';
import { JwtProvider } from '../../src/providers/jwt.provider.js';
import { PhoneFactorService } from '../../src/factors/phone/phone.factor.service.js';
import { EmailFactorService } from '../../src/factors/email/email.factor.service.js';
import { FidoFactorService } from '../../src/factors/fido/fido.factor.service.js';
import { AuthenticatorFactorService } from '../../src/factors/authenticator/authenticator.factor.service.js';
import { AuthenticationSessionFactor } from '../../src/types.js';

const makeCache = () => {
  const store = new Map<string, string>();
  return {
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
  } as unknown as CacheProvider;
};

const makeJwtProvider = () =>
  ({
    create: vi.fn().mockReturnValue({ token: 'jwt-token', decoded: { exp: 1800, scope: [] } }),
    decode: vi.fn(),
  }) as unknown as JwtProvider;

const makePolicyService = (resultFor: (name: string) => PolicyResult) =>
  ({
    check: vi.fn(async (name: string) => resultFor(name)),
    assert: vi.fn(async (name: string) => {
      const r = resultFor(name);
      if (isPolicyResultDenied(r)) throw new Error(r.reason);
    }),
  }) as unknown as PolicyService;

const primaryFactor: AuthenticationSessionFactor = {
  method: 'password',
  methodId: 'pw-1',
  kind: 'knowledge',
  issuedAt: DateTime.utc(),
  authenticatedAt: DateTime.utc(),
};

const actor = { kind: 'user', actorId: 'user-7' };

const phoneEligible = [{ method: 'phone' as const, methodId: 'phone-1', kind: 'possession' as const }];

const makeOrchestrator = (overrides: { policy: PolicyResult }) => {
  const cache = makeCache();
  const challengeService = new MfaChallengeService(new MfaChallengeServiceOptions(), cache);
  const sessionService = new AuthenticationSessionService(
    new AuthenticationSessionServiceOptions('iss', 'aud', Duration.fromObject({ hours: 1 })),
    cache,
    makeJwtProvider(),
  );

  const phoneFactor = {
    issuePhoneChallenge: vi.fn(async () => ({
      phone: '+12025550123',
      challengeId: 'phone-chal-1',
      code: '123456',
      expiresAt: DateTime.utc().plus({ minutes: 10 }),
      issuedAt: DateTime.utc(),
      alreadyIssued: false,
    })),
    verifyPhoneChallenge: vi.fn(async () => ({ id: 'phone-1', actorId: actor.actorId, active: true, value: '+12025550123' })),
  } as unknown as PhoneFactorService;

  const emailFactor = {
    issueEmailChallenge: vi.fn(),
    verifyEmailChallenge: vi.fn(),
  } as unknown as EmailFactorService;

  const fidoFactor = {
    createFidoAuthorizationChallenge: vi.fn(),
    verifyFidoAuthorizationChallenge: vi.fn(),
  } as unknown as FidoFactorService;

  const authenticatorFactor = {
    validateFactor: vi.fn(),
  } as unknown as AuthenticatorFactorService;

  const policyService = makePolicyService(() => overrides.policy);

  const orchestrator = new MfaOrchestrator(
    sessionService,
    challengeService,
    policyService,
    phoneFactor,
    fidoFactor,
    authenticatorFactor,
    emailFactor,
  );

  return { orchestrator, challengeService, phoneFactor, policyService };
};

describe('MfaOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('issueOrChallenge', () => {
    it('mints a session and returns a token when the policy allows', async () => {
      const { orchestrator, policyService } = makeOrchestrator({ policy: { allowed: true } });

      const result = await orchestrator.issueOrChallenge(actor, primaryFactor, [], { role: 'admin' });

      expect(result.status).toBe('token');
      expect(policyService.check).toHaveBeenCalledWith('auth.mfa.required', {
        actor,
        primaryFactor,
        availableFactors: [],
      });
    });

    it('stashes a challenge and returns mfa_required when the policy denies', async () => {
      const { orchestrator } = makeOrchestrator({
        policy: { allowed: false, reason: 'mfa_required', details: { eligibleFactors: phoneEligible.map(({ method, methodId }) => ({ method, methodId })) } },
      });

      const result = await orchestrator.issueOrChallenge(actor, primaryFactor, phoneEligible, { role: 'admin' });

      expect(result.status).toBe('mfa_required');
      if (result.status === 'mfa_required') {
        expect(result.mfaChallengeId).toBeTruthy();
        expect(result.eligibleFactors).toEqual([{ method: 'phone', methodId: 'phone-1' }]);
      }
    });
  });

  describe('startFactorChallenge', () => {
    it('throws 404 when the mfa challenge id is unknown', async () => {
      const { orchestrator } = makeOrchestrator({ policy: { allowed: true } });

      await expect(
        orchestrator.startFactorChallenge('does-not-exist', { method: 'phone', methodId: 'phone-1' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 400 when the selected factor is not on the eligible list', async () => {
      const { orchestrator, challengeService } = makeOrchestrator({ policy: { allowed: true } });
      const challenge = await challengeService.issue({
        actor,
        primaryFactor,
        eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }],
      });

      await expect(
        orchestrator.startFactorChallenge(challenge.challengeId, { method: 'fido', methodId: 'fido-99' }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('issues a phone challenge and returns the code, recipient, and transport for the consumer to deliver', async () => {
      const { orchestrator, challengeService, phoneFactor } = makeOrchestrator({ policy: { allowed: true } });
      const challenge = await challengeService.issue({
        actor,
        primaryFactor,
        eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }],
      });

      const response = await orchestrator.startFactorChallenge(challenge.challengeId, { method: 'phone', methodId: 'phone-1', transport: 'voice' });

      expect(response.method).toBe('phone');
      if (response.method === 'phone') {
        expect(response.transport).toBe('voice');
        expect(response.alreadyIssued).toBe(false);
        expect(response.phoneNumber).toBe('+12025550123');
        expect(response.code).toBe('123456');
      }
      expect(phoneFactor.issuePhoneChallenge).toHaveBeenCalledWith(actor.actorId, 'phone-1');
    });

    it('passes through alreadyIssued=true so the consumer can suppress duplicate sends', async () => {
      const { orchestrator, challengeService, phoneFactor } = makeOrchestrator({ policy: { allowed: true } });
      (phoneFactor.issuePhoneChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        phone: '+12025550123',
        challengeId: 'phone-chal-1',
        code: '123456',
        expiresAt: DateTime.utc().plus({ minutes: 10 }),
        issuedAt: DateTime.utc(),
        alreadyIssued: true,
      });

      const challenge = await challengeService.issue({
        actor,
        primaryFactor,
        eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }],
      });

      const response = await orchestrator.startFactorChallenge(challenge.challengeId, { method: 'phone', methodId: 'phone-1' });
      expect(response.method).toBe('phone');
      if (response.method === 'phone') {
        expect(response.alreadyIssued).toBe(true);
      }
    });
  });

  describe('completeMfa', () => {
    it('verifies the proof, redeems the challenge, and mints a token', async () => {
      const { orchestrator, challengeService, phoneFactor } = makeOrchestrator({ policy: { allowed: true } });
      const challenge = await challengeService.issue({
        actor,
        primaryFactor,
        eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }],
      });

      const result = await orchestrator.completeMfa(challenge.challengeId, { method: 'phone', challengeId: 'phone-chal-1', code: '123456' }, { role: 'admin' });

      expect(result.status).toBe('token');
      expect(phoneFactor.verifyPhoneChallenge).toHaveBeenCalledWith('phone-chal-1', '123456');

      // Second completion attempt should 404 because the challenge was redeemed.
      await expect(
        orchestrator.completeMfa(challenge.challengeId, { method: 'phone', challengeId: 'phone-chal-1', code: '123456' }, {}),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects when the verified factor is not on the eligible list', async () => {
      const { orchestrator, challengeService, phoneFactor } = makeOrchestrator({ policy: { allowed: true } });

      // Verified factor will report methodId 'phone-other', but the challenge only listed 'phone-1'.
      (phoneFactor.verifyPhoneChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'phone-other',
        actorId: actor.actorId,
        active: true,
        value: '+12025550999',
      });

      const challenge = await challengeService.issue({
        actor,
        primaryFactor,
        eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }],
      });

      await expect(
        orchestrator.completeMfa(challenge.challengeId, { method: 'phone', challengeId: 'phone-chal-1', code: '123456' }, {}),
      ).rejects.toMatchObject({ statusCode: 400 });

      // Challenge should still be redeemable because we peek-then-delete on success only.
      const stillThere = await challengeService.peek(challenge.challengeId);
      expect(stillThere).not.toBeNull();
    });

    it('full flow: issueOrChallenge → startFactorChallenge → completeMfa → token', async () => {
      const { orchestrator, phoneFactor } = makeOrchestrator({
        policy: { allowed: false, reason: 'mfa_required', details: { eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }] } },
      });

      const challenge = await orchestrator.issueOrChallenge(actor, primaryFactor, phoneEligible, {});
      expect(challenge.status).toBe('mfa_required');
      if (challenge.status !== 'mfa_required') return;

      const started = await orchestrator.startFactorChallenge(challenge.mfaChallengeId, { method: 'phone', methodId: 'phone-1' });
      expect(started.method).toBe('phone');
      if (started.method === 'phone') {
        // Consumer would send `started.code` to `started.phoneNumber` here.
        expect(started.code).toBe('123456');
        expect(started.phoneNumber).toBe('+12025550123');
      }

      const token = await orchestrator.completeMfa(
        challenge.mfaChallengeId,
        { method: 'phone', challengeId: 'phone-chal-1', code: '123456' },
        { role: 'admin' },
      );

      expect(token.status).toBe('token');
      expect(phoneFactor.verifyPhoneChallenge).toHaveBeenCalledWith('phone-chal-1', '123456');
    });
  });
});
