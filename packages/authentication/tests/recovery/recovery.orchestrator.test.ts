import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { isPolicyResultDenied, PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { RecoveryOrchestrator, RecoveryOrchestratorHooks, RecoveryOrchestratorHooksProvider } from '../../src/recovery/recovery.orchestrator.js';
import { RecoveryChallengeService, RecoveryChallengeServiceOptions } from '../../src/recovery/recovery.challenge.service.js';
import { RecoverySessionService, RecoverySessionServiceOptions } from '../../src/recovery/recovery.session.service.js';
import type { EmailFactorService } from '../../src/factors/email/email.factor.service.js';
import type { PhoneFactorService } from '../../src/factors/phone/phone.factor.service.js';
import type { PasswordFactorService } from '../../src/factors/password/password.factor.service.js';
import type { RecoveryFactorService } from '../../src/factors/recovery/recovery.factor.service.js';

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

const actor = { kind: 'user', actorId: 'user-7' };

const makeOrchestrator = (overrides: { policy?: PolicyResult; hooks?: RecoveryOrchestratorHooks } = {}) => {
  const cache = makeCache();
  const challengeService = new RecoveryChallengeService(new RecoveryChallengeServiceOptions(), cache);
  const sessionService = new RecoverySessionService(new RecoverySessionServiceOptions(), cache);

  const emailFactor = {
    listFactors: vi.fn(async () => [{ id: 'email-1', actorId: actor.actorId, active: true, value: 'user@example.com' }]),
    findFactor: vi.fn(async (value: string) =>
      value === 'user@example.com' ? { id: 'email-1', actorId: actor.actorId, active: true, value } : undefined,
    ),
    issueEmailChallenge: vi.fn(async () => ({
      email: 'user@example.com',
      challengeId: 'email-chal-1',
      code: '123456',
      expiresAt: DateTime.utc().plus({ minutes: 10 }),
      issuedAt: DateTime.utc(),
      alreadyIssued: false,
    })),
    verifyEmailChallenge: vi.fn(async () => ({ id: 'email-1', actorId: actor.actorId, active: true, value: 'user@example.com' })),
  } as unknown as EmailFactorService;

  const phoneFactor = {
    listFactors: vi.fn(async () => [{ id: 'phone-1', actorId: actor.actorId, active: true, value: '+12025550123' }]),
    issuePhoneChallenge: vi.fn(async () => ({
      phone: '+12025550123',
      challengeId: 'phone-chal-1',
      code: '654321',
      expiresAt: DateTime.utc().plus({ minutes: 10 }),
      issuedAt: DateTime.utc(),
      alreadyIssued: false,
    })),
    verifyPhoneChallenge: vi.fn(async () => ({ id: 'phone-1', actorId: actor.actorId, active: true, value: '+12025550123' })),
  } as unknown as PhoneFactorService;

  const passwordFactor = {
    changePassword: vi.fn(async () => ({ id: 'pw-1', actorId: actor.actorId, active: true, needsReset: false })),
    clearRateLimit: vi.fn(async () => undefined),
  } as unknown as PasswordFactorService;

  const recoveryFactor = {
    countRemainingCodes: vi.fn(async () => 5),
    verifyRecoveryCode: vi.fn(async () => ({ id: 'rc-1', actorId: actor.actorId, active: false, value: { hash: 'h', salt: 's' }, batchId: 'b-1' })),
  } as unknown as RecoveryFactorService;

  const policy = overrides.policy ?? ({ allowed: true } as PolicyResult);
  const policyService = makePolicyService(() => policy);

  const orchestrator = new RecoveryOrchestrator(
    challengeService,
    sessionService,
    policyService,
    emailFactor,
    phoneFactor,
    passwordFactor,
    recoveryFactor,
    new RecoveryOrchestratorHooksProvider(overrides.hooks ?? {}),
  );

  return { orchestrator, challengeService, sessionService, policyService, emailFactor, phoneFactor, passwordFactor, recoveryFactor };
};

describe('RecoveryOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initiateRecovery', () => {
    it('resolves the actor by actorId and returns email + phone channels for password_reset', async () => {
      const { orchestrator } = makeOrchestrator();

      const result = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'password_reset' });

      expect(result.challengeId).toBeTruthy();
      expect(result.eligibleChannels).toEqual([
        { channel: 'email', methodId: 'email-1', label: 'user@example.com' },
        { channel: 'phone', methodId: 'phone-1', label: '+12025550123' },
      ]);
    });

    it('omits the recoveryCode channel for password_reset even when codes exist', async () => {
      const { orchestrator } = makeOrchestrator();

      const result = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'password_reset' });
      expect(result.eligibleChannels.some(c => c.channel === 'recoveryCode')).toBe(false);
    });

    it('includes the recoveryCode channel for mfa_recovery when codes exist', async () => {
      const { orchestrator } = makeOrchestrator();

      const result = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'mfa_recovery' });
      expect(result.eligibleChannels.some(c => c.channel === 'recoveryCode')).toBe(true);
    });

    it('resolves the actor by email identifier', async () => {
      const { orchestrator, emailFactor } = makeOrchestrator();

      const result = await orchestrator.initiateRecovery({
        identifier: { kind: 'email', value: 'user@example.com' },
        reason: 'password_reset',
      });

      expect(emailFactor.findFactor).toHaveBeenCalledWith('user@example.com');
      expect(result.eligibleChannels.length).toBeGreaterThan(0);
    });

    it('returns an empty-channels challenge for an unknown email identifier (no enumeration)', async () => {
      const { orchestrator } = makeOrchestrator();

      const result = await orchestrator.initiateRecovery({
        identifier: { kind: 'email', value: 'nobody@example.com' },
        reason: 'password_reset',
      });

      expect(result.challengeId).toBeTruthy();
      expect(result.eligibleChannels).toEqual([]);
    });

    it('throws 403 when the recovery.allowed policy denies', async () => {
      const { orchestrator } = makeOrchestrator({ policy: { allowed: false, reason: 'no_eligible_channel' } });

      await expect(orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'password_reset' })).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });

  describe('issueChannelChallenge', () => {
    it('throws 404 when the recovery challenge id is unknown', async () => {
      const { orchestrator } = makeOrchestrator();

      await expect(orchestrator.issueChannelChallenge('does-not-exist', { channel: 'email', methodId: 'email-1' })).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('throws 400 when the selected channel is not on the eligible list', async () => {
      const { orchestrator } = makeOrchestrator();
      const initiated = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'password_reset' });

      await expect(
        orchestrator.issueChannelChallenge(initiated.challengeId, { channel: 'email', methodId: 'email-other' }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('issues an email challenge via the email factor service', async () => {
      const { orchestrator, emailFactor } = makeOrchestrator();
      const initiated = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'password_reset' });

      const response = await orchestrator.issueChannelChallenge(initiated.challengeId, {
        channel: 'email',
        methodId: 'email-1',
      });

      expect(response.channel).toBe('email');
      if (response.channel === 'email') {
        expect(response.emailAddress).toBe('user@example.com');
        expect(response.code).toBe('123456');
        expect(response.issueMethod).toBe('code');
      }
      expect(emailFactor.issueEmailChallenge).toHaveBeenCalledWith(actor.actorId, 'email-1', 'code');
    });

    it('returns a recoveryCode stub when the recoveryCode channel is selected', async () => {
      const { orchestrator } = makeOrchestrator();
      const initiated = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'mfa_recovery' });

      const response = await orchestrator.issueChannelChallenge(initiated.challengeId, { channel: 'recoveryCode' });
      expect(response.channel).toBe('recoveryCode');
      if (response.channel === 'recoveryCode') {
        expect(response.expiresAt).toBeInstanceOf(DateTime);
      }
    });
  });

  describe('verifyChannel', () => {
    it('verifies an email channel, redeems the parent challenge, and mints a recovery session', async () => {
      const { orchestrator, challengeService, emailFactor } = makeOrchestrator();
      const initiated = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'password_reset' });
      await orchestrator.issueChannelChallenge(initiated.challengeId, { channel: 'email', methodId: 'email-1' });

      const result = await orchestrator.verifyChannel(initiated.challengeId, {
        channel: 'email',
        channelChallengeId: 'email-chal-1',
        code: '123456',
      });

      expect(result.recoverySessionToken).toBeTruthy();
      expect(result.grantedActions).toEqual(['resetPassword']);
      expect(emailFactor.verifyEmailChallenge).toHaveBeenCalledWith('email-chal-1', '123456');

      // Parent challenge is redeemed (single-use).
      expect(await challengeService.peek(initiated.challengeId)).toBeNull();
    });

    it('grants rebindMfaFactor when reason is mfa_recovery', async () => {
      const { orchestrator } = makeOrchestrator();
      const initiated = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'mfa_recovery' });
      await orchestrator.issueChannelChallenge(initiated.challengeId, { channel: 'phone', methodId: 'phone-1' });

      const result = await orchestrator.verifyChannel(initiated.challengeId, {
        channel: 'phone',
        channelChallengeId: 'phone-chal-1',
        code: '654321',
      });

      expect(result.grantedActions).toEqual(['rebindMfaFactor']);
    });

    it('verifies a recovery code', async () => {
      const { orchestrator, recoveryFactor } = makeOrchestrator();
      const initiated = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'mfa_recovery' });
      await orchestrator.issueChannelChallenge(initiated.challengeId, { channel: 'recoveryCode' });

      const result = await orchestrator.verifyChannel(initiated.challengeId, { channel: 'recoveryCode', code: 'ABCDE-FGHJK-MNPQR' });

      expect(result.recoverySessionToken).toBeTruthy();
      expect(recoveryFactor.verifyRecoveryCode).toHaveBeenCalledWith(actor.actorId, 'ABCDE-FGHJK-MNPQR');
    });

    it('throws 404 when the recovery challenge has expired', async () => {
      const { orchestrator } = makeOrchestrator();
      await expect(
        orchestrator.verifyChannel('does-not-exist', { channel: 'email', channelChallengeId: 'x', code: '000000' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects when the proof channel does not match the selected channel', async () => {
      const { orchestrator } = makeOrchestrator();
      const initiated = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'password_reset' });
      await orchestrator.issueChannelChallenge(initiated.challengeId, { channel: 'email', methodId: 'email-1' });

      await expect(
        orchestrator.verifyChannel(initiated.challengeId, { channel: 'phone', channelChallengeId: 'phone-chal-1', code: '654321' }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('completeRecovery', () => {
    const verify = async (reason: 'password_reset' | 'mfa_recovery' | 'unlock' | 'full_recovery') => {
      const setup = makeOrchestrator();
      const { orchestrator, recoveryFactor } = setup;
      // For full_recovery we need a recoveryCode channel in eligible list — already provided.
      // mfa_recovery and full_recovery both include it via countRemainingCodes mock returning 5.
      if (reason === 'unlock' || reason === 'password_reset') {
        (recoveryFactor.countRemainingCodes as ReturnType<typeof vi.fn>).mockResolvedValue(0);
      }
      const initiated = await orchestrator.initiateRecovery({ actorId: actor.actorId, reason });
      if (reason === 'full_recovery') {
        await orchestrator.issueChannelChallenge(initiated.challengeId, { channel: 'recoveryCode' });
        const verified = await orchestrator.verifyChannel(initiated.challengeId, { channel: 'recoveryCode', code: 'ABCDE-FGHJK-MNPQR' });
        return { setup, verified };
      }
      await orchestrator.issueChannelChallenge(initiated.challengeId, { channel: 'email', methodId: 'email-1' });
      const verified = await orchestrator.verifyChannel(initiated.challengeId, {
        channel: 'email',
        channelChallengeId: 'email-chal-1',
        code: '123456',
      });
      return { setup, verified };
    };

    it('resetPassword calls changePassword and clearRateLimit', async () => {
      const { setup, verified } = await verify('password_reset');

      const result = await setup.orchestrator.completeRecovery(verified.recoverySessionToken, {
        kind: 'resetPassword',
        newPassword: 'new-secure-password',
      });

      expect(result.action.kind).toBe('resetPassword');
      expect(setup.passwordFactor.changePassword).toHaveBeenCalledWith(actor.actorId, 'new-secure-password');
      expect(setup.passwordFactor.clearRateLimit).toHaveBeenCalledWith(actor.actorId);
    });

    it('unlockAccount calls clearRateLimit and onUnlock hook', async () => {
      const onUnlock = vi.fn();
      const setup = makeOrchestrator({ hooks: { onUnlock } });
      (setup.recoveryFactor.countRemainingCodes as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const initiated = await setup.orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'unlock' });
      await setup.orchestrator.issueChannelChallenge(initiated.challengeId, { channel: 'email', methodId: 'email-1' });
      const verified = await setup.orchestrator.verifyChannel(initiated.challengeId, {
        channel: 'email',
        channelChallengeId: 'email-chal-1',
        code: '123456',
      });

      const result = await setup.orchestrator.completeRecovery(verified.recoverySessionToken, { kind: 'unlockAccount' });

      expect(result.action.kind).toBe('unlockAccount');
      expect(setup.passwordFactor.clearRateLimit).toHaveBeenCalledWith(actor.actorId);
      expect(onUnlock).toHaveBeenCalledWith(actor.actorId);
    });

    it('throws 403 when the requested action is not in the granted list', async () => {
      const { setup, verified } = await verify('password_reset');

      await expect(
        setup.orchestrator.completeRecovery(verified.recoverySessionToken, { kind: 'fullRecovery', identityProof: {} }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('redeems the recovery session — second completeRecovery returns 404', async () => {
      const { setup, verified } = await verify('password_reset');

      await setup.orchestrator.completeRecovery(verified.recoverySessionToken, {
        kind: 'resetPassword',
        newPassword: 'new-secure-password',
      });

      await expect(
        setup.orchestrator.completeRecovery(verified.recoverySessionToken, {
          kind: 'resetPassword',
          newPassword: 'another-password',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('fullRecovery invokes onFullRecovery hook with the identityProof', async () => {
      const onFullRecovery = vi.fn();
      const setup = makeOrchestrator({ hooks: { onFullRecovery } });

      const initiated = await setup.orchestrator.initiateRecovery({ actorId: actor.actorId, reason: 'full_recovery' });
      await setup.orchestrator.issueChannelChallenge(initiated.challengeId, { channel: 'recoveryCode' });
      const verified = await setup.orchestrator.verifyChannel(initiated.challengeId, {
        channel: 'recoveryCode',
        code: 'ABCDE-FGHJK-MNPQR',
      });

      const identityProof = { providedBy: 'admin', ticketId: 'T-1234' };
      const result = await setup.orchestrator.completeRecovery(verified.recoverySessionToken, {
        kind: 'fullRecovery',
        identityProof,
      });

      expect(result.action.kind).toBe('fullRecovery');
      expect(onFullRecovery).toHaveBeenCalledWith({ actorId: actor.actorId, identityProof });
    });
  });

  describe('full flow', () => {
    it('initiateRecovery → issueChannelChallenge → verifyChannel → completeRecovery', async () => {
      const { orchestrator, passwordFactor } = makeOrchestrator();

      const initiated = await orchestrator.initiateRecovery({
        identifier: { kind: 'email', value: 'user@example.com' },
        reason: 'password_reset',
      });
      expect(initiated.eligibleChannels.length).toBeGreaterThan(0);

      const issued = await orchestrator.issueChannelChallenge(initiated.challengeId, {
        channel: 'email',
        methodId: 'email-1',
      });
      expect(issued.channel).toBe('email');

      const verified = await orchestrator.verifyChannel(initiated.challengeId, {
        channel: 'email',
        channelChallengeId: 'email-chal-1',
        code: '123456',
      });
      expect(verified.grantedActions).toEqual(['resetPassword']);

      const completed = await orchestrator.completeRecovery(verified.recoverySessionToken, {
        kind: 'resetPassword',
        newPassword: 'fresh-password',
      });
      expect(completed.action.kind).toBe('resetPassword');
      expect(passwordFactor.changePassword).toHaveBeenCalledWith(actor.actorId, 'fresh-password');
    });
  });
});
