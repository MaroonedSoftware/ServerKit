import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { isPolicyResultDenied, PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { MfaOrchestrator } from '../../src/mfa/mfa.orchestrator.js';
import { MfaChallengeService, MfaChallengeServiceOptions } from '../../src/mfa/mfa.challenge.service.js';
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
    it("returns kind: 'allow' with the actor and primary factor when the policy allows", async () => {
      const { orchestrator, policyService } = makeOrchestrator({ policy: { allowed: true } });

      const result = await orchestrator.issueOrChallenge(actor, primaryFactor, []);

      expect(result.kind).toBe('allow');
      if (result.kind === 'allow') {
        expect(result.actor).toEqual(actor);
        expect(result.primaryFactor).toEqual(primaryFactor);
      }
      expect(policyService.check).toHaveBeenCalledWith('auth.mfa.required', {
        actor,
        primaryFactor,
        availableFactors: [],
      });
    });

    it("returns kind: 'challenge' with the full challenge payload when the policy denies", async () => {
      const { orchestrator } = makeOrchestrator({
        policy: {
          allowed: false,
          reason: 'mfa_required',
          details: { eligibleFactors: phoneEligible.map(({ method, methodId }) => ({ method, methodId })) },
        },
      });

      const result = await orchestrator.issueOrChallenge(actor, primaryFactor, phoneEligible);

      expect(result.kind).toBe('challenge');
      if (result.kind === 'challenge') {
        expect(result.challenge.challengeId).toBeTruthy();
        expect(result.challenge.eligibleFactors).toEqual([{ method: 'phone', methodId: 'phone-1' }]);
        expect(result.challenge.actor).toEqual(actor);
        expect(result.challenge.primaryFactor).toEqual(primaryFactor);
        expect(result.challenge.issuedAt).toBeInstanceOf(DateTime);
        expect(result.challenge.expiresAt).toBeInstanceOf(DateTime);
      }
    });

    it('surfaces labels from the policy result onto the challenge payload', async () => {
      const labeled = [{ method: 'phone' as const, methodId: 'phone-1', label: '+1·····1234' }];
      const { orchestrator } = makeOrchestrator({
        policy: { allowed: false, reason: 'mfa_required', details: { eligibleFactors: labeled } },
      });

      const result = await orchestrator.issueOrChallenge(actor, primaryFactor, [{ ...labeled[0]!, kind: 'possession' }]);

      expect(result.kind).toBe('challenge');
      if (result.kind === 'challenge') {
        expect(result.challenge.eligibleFactors).toEqual(labeled);
      }
    });
  });

  describe('issueFactorChallenge', () => {
    it('throws 404 when the mfa challenge id is unknown', async () => {
      const { orchestrator } = makeOrchestrator({ policy: { allowed: true } });

      await expect(orchestrator.issueFactorChallenge('does-not-exist', { method: 'phone', methodId: 'phone-1' })).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('throws 400 when the selected factor is not on the eligible list', async () => {
      const { orchestrator, challengeService } = makeOrchestrator({ policy: { allowed: true } });
      const challenge = await challengeService.issue({
        actor,
        primaryFactor,
        eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }],
      });

      await expect(orchestrator.issueFactorChallenge(challenge.challengeId, { method: 'fido', methodId: 'fido-99' })).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('issues a phone challenge and returns the code, recipient, and transport for the consumer to deliver', async () => {
      const { orchestrator, challengeService, phoneFactor } = makeOrchestrator({ policy: { allowed: true } });
      const challenge = await challengeService.issue({
        actor,
        primaryFactor,
        eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }],
      });

      const response = await orchestrator.issueFactorChallenge(challenge.challengeId, { method: 'phone', methodId: 'phone-1', transport: 'whatsapp' });

      expect(response.method).toBe('phone');
      if (response.method === 'phone') {
        expect(response.transport).toBe('whatsapp');
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

      const response = await orchestrator.issueFactorChallenge(challenge.challengeId, { method: 'phone', methodId: 'phone-1' });
      expect(response.method).toBe('phone');
      if (response.method === 'phone') {
        expect(response.alreadyIssued).toBe(true);
      }
    });
  });

  describe('completeMfa', () => {
    it('verifies the proof, redeems the challenge, and returns actor + factors', async () => {
      const { orchestrator, challengeService, phoneFactor } = makeOrchestrator({ policy: { allowed: true } });
      const redeemSpy = vi.spyOn(challengeService, 'redeem');
      const challenge = await challengeService.issue({
        actor,
        primaryFactor,
        eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }],
      });

      const result = await orchestrator.completeMfa(challenge.challengeId, { method: 'phone', challengeId: 'phone-chal-1', code: '123456' });

      expect(result.actor).toEqual(actor);
      // primaryFactor carries over from the cached challenge — verify the structural fields. (DateTimes
      // are serialized through the cache so exact-instant comparison isn't meaningful here.)
      expect(result.primaryFactor).toMatchObject({ method: 'password', methodId: 'pw-1', kind: 'knowledge' });
      expect(result.primaryFactor.issuedAt).toBeInstanceOf(DateTime);
      expect(result.primaryFactor.authenticatedAt).toBeInstanceOf(DateTime);
      expect(result.secondaryFactor).toMatchObject({ method: 'phone', methodId: 'phone-1', kind: 'possession' });
      expect(result.secondaryFactor.issuedAt).toBeInstanceOf(DateTime);
      expect(result.secondaryFactor.authenticatedAt).toBeInstanceOf(DateTime);
      expect(phoneFactor.verifyPhoneChallenge).toHaveBeenCalledWith('phone-chal-1', '123456');
      expect(redeemSpy).toHaveBeenCalledWith(challenge.challengeId);

      // Second completion attempt should 404 because the challenge was redeemed.
      await expect(
        orchestrator.completeMfa(challenge.challengeId, { method: 'phone', challengeId: 'phone-chal-1', code: '123456' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('does not mint a session — session minting is consumer-side', async () => {
      // The orchestrator constructor no longer accepts an AuthenticationSessionService,
      // which is the structural guarantee this test depends on. Belt-and-braces: a
      // successful completeMfa must return pure data with no token field.
      const { orchestrator, challengeService } = makeOrchestrator({ policy: { allowed: true } });
      const challenge = await challengeService.issue({
        actor,
        primaryFactor,
        eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }],
      });

      const result = await orchestrator.completeMfa(challenge.challengeId, { method: 'phone', challengeId: 'phone-chal-1', code: '123456' });

      expect(result).not.toHaveProperty('token');
      expect(result).not.toHaveProperty('result');
      expect(Object.keys(result).sort()).toEqual(['actor', 'primaryFactor', 'secondaryFactor']);
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
        orchestrator.completeMfa(challenge.challengeId, { method: 'phone', challengeId: 'phone-chal-1', code: '123456' }),
      ).rejects.toMatchObject({ statusCode: 400 });

      // Challenge should still be redeemable because we peek-then-delete on success only.
      const stillThere = await challengeService.peek(challenge.challengeId);
      expect(stillThere).not.toBeNull();
    });

    it('full flow: issueOrChallenge → issueFactorChallenge → completeMfa → actor + factors', async () => {
      const { orchestrator, phoneFactor } = makeOrchestrator({
        policy: { allowed: false, reason: 'mfa_required', details: { eligibleFactors: [{ method: 'phone', methodId: 'phone-1' }] } },
      });

      const issued = await orchestrator.issueOrChallenge(actor, primaryFactor, phoneEligible);
      expect(issued.kind).toBe('challenge');
      if (issued.kind !== 'challenge') return;

      const started = await orchestrator.issueFactorChallenge(issued.challenge.challengeId, { method: 'phone', methodId: 'phone-1' });
      expect(started.method).toBe('phone');
      if (started.method === 'phone') {
        // Consumer would send `started.code` to `started.phoneNumber` here.
        expect(started.code).toBe('123456');
        expect(started.phoneNumber).toBe('+12025550123');
      }

      const completed = await orchestrator.completeMfa(issued.challenge.challengeId, {
        method: 'phone',
        challengeId: 'phone-chal-1',
        code: '123456',
      });

      expect(completed.actor).toEqual(actor);
      expect(completed.primaryFactor).toMatchObject({ method: 'password', methodId: 'pw-1', kind: 'knowledge' });
      expect(completed.secondaryFactor).toMatchObject({ method: 'phone', methodId: 'phone-1', kind: 'possession' });
      expect(phoneFactor.verifyPhoneChallenge).toHaveBeenCalledWith('phone-chal-1', '123456');
    });
  });
});
