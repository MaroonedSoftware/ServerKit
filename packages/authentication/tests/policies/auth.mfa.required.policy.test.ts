import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { AuthMfaRequiredPolicyContext, AuthMfaRequiredPolicyFactor, DefaultMfaRequiredPolicy } from '../../src/policies/auth.mfa.required.policy.js';
import { AuthenticationFactorKind, AuthenticationFactorMethod, AuthenticationSessionFactor } from '../../src/types.js';

const envelope = { now: DateTime.utc() };

const policy = new DefaultMfaRequiredPolicy();

const actor = { kind: 'user', actorId: 'user-1' };

const makePrimary = (method: AuthenticationFactorMethod, kind: AuthenticationFactorKind = 'knowledge'): AuthenticationSessionFactor => ({
  method,
  methodId: `${method}-pri`,
  kind,
  issuedAt: DateTime.utc(),
  authenticatedAt: DateTime.utc(),
});

const factor = (method: AuthenticationFactorMethod, kind: AuthenticationFactorKind, methodId = `${method}-1`): AuthMfaRequiredPolicyFactor => ({
  method,
  methodId,
  kind,
});

const evaluate = (context: AuthMfaRequiredPolicyContext) => policy.evaluate(context, envelope);

describe('DefaultMfaRequiredPolicy', () => {
  it('allows when no factors are on file', async () => {
    const result = await evaluate({ actor, primaryFactor: makePrimary('password'), availableFactors: [] });
    expect(result).toEqual({ allowed: true });
  });

  it('allows when the only available factor is itself knowledge (e.g. a second password)', async () => {
    const result = await evaluate({
      actor,
      primaryFactor: makePrimary('password'),
      availableFactors: [factor('password', 'knowledge', 'pw-backup')],
    });
    expect(result).toEqual({ allowed: true });
  });

  it('allows when the only available factors are oidc or email (weak second factors)', async () => {
    const result = await evaluate({
      actor,
      primaryFactor: makePrimary('password'),
      availableFactors: [factor('email', 'possession'), factor('oidc', 'possession')],
    });
    expect(result).toEqual({ allowed: true });
  });

  it('requires MFA and returns the eligible factor list when a possession factor is available', async () => {
    const phone = factor('phone', 'possession');
    const result = await evaluate({ actor, primaryFactor: makePrimary('password'), availableFactors: [phone] });
    expect(result).toEqual({
      allowed: false,
      reason: 'mfa_required',
      details: { eligibleFactors: [{ method: 'phone', methodId: phone.methodId }] },
    });
  });

  it('filters knowledge, oidc, and email out of the eligible list', async () => {
    const phone = factor('phone', 'possession');
    const fido = factor('fido', 'possession');
    const result = await evaluate({
      actor,
      primaryFactor: makePrimary('password'),
      availableFactors: [
        factor('password', 'knowledge', 'pw-backup'),
        factor('email', 'possession'),
        factor('oidc', 'possession'),
        phone,
        fido,
      ],
    });
    expect(result.allowed).toBe(false);
    expect((result as { details: { eligibleFactors: AuthMfaRequiredPolicyFactor[] } }).details.eligibleFactors).toEqual([
      { method: 'phone', methodId: phone.methodId },
      { method: 'fido', methodId: fido.methodId },
    ]);
  });

  it.each<[AuthenticationFactorMethod, AuthenticationFactorKind]>([
    ['authenticator', 'possession'],
    ['phone', 'possession'],
    ['fido', 'possession'],
  ])('requires MFA when only a single %s/%s factor is available', async (method, kind) => {
    const result = await evaluate({
      actor,
      primaryFactor: makePrimary('password'),
      availableFactors: [factor(method, kind)],
    });
    expect(result.allowed).toBe(false);
    expect((result as { reason: string }).reason).toBe('mfa_required');
  });

  it.each<AuthenticationFactorMethod>(['phone', 'fido', 'authenticator'])(
    'still requires MFA when the primary factor itself is %s (orchestrator excludes duplicates separately)',
    async method => {
      // The policy is agnostic to whether the primary factor appears in availableFactors —
      // the orchestrator owns that filter.
      const second = factor('phone', 'possession', 'phone-other');
      const result = await evaluate({
        actor,
        primaryFactor: makePrimary(method, 'possession'),
        availableFactors: [second],
      });
      expect(result.allowed).toBe(false);
    },
  );
});
