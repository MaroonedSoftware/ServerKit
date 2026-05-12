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

const factor = (
  method: AuthenticationFactorMethod,
  kind: AuthenticationFactorKind,
  methodId = `${method}-1`,
  label?: string | null,
): AuthMfaRequiredPolicyFactor => ({
  method,
  methodId,
  kind,
  ...(label !== undefined ? { label } : {}),
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

  it('requires MFA and returns the eligible factor list when a possession factor is available', async () => {
    const phone = factor('phone', 'possession');
    const result = await evaluate({ actor, primaryFactor: makePrimary('password'), availableFactors: [phone] });
    expect(result).toEqual({
      allowed: false,
      reason: 'mfa_required',
      details: { eligibleFactors: [{ method: 'phone', methodId: phone.methodId }] },
    });
  });

  it('allows email and oidc as second factors when the primary is a different method', async () => {
    const email = factor('email', 'possession');
    const oidc = factor('oidc', 'possession');
    const result = await evaluate({
      actor,
      primaryFactor: makePrimary('password'),
      availableFactors: [email, oidc],
    });
    expect(result.allowed).toBe(false);
    expect((result as { details: { eligibleFactors: AuthMfaRequiredPolicyFactor[] } }).details.eligibleFactors).toEqual([
      { method: 'email', methodId: email.methodId },
      { method: 'oidc', methodId: oidc.methodId },
    ]);
  });

  it('excludes email from eligible factors when the primary was email (no email-after-email loop)', async () => {
    const result = await evaluate({
      actor,
      primaryFactor: makePrimary('email', 'possession'),
      availableFactors: [factor('email', 'possession', 'email-other')],
    });
    expect(result).toEqual({ allowed: true });
  });

  it('excludes oidc from eligible factors when the primary was oidc', async () => {
    const result = await evaluate({
      actor,
      primaryFactor: makePrimary('oidc', 'possession'),
      availableFactors: [factor('oidc', 'possession', 'oidc-other')],
    });
    expect(result).toEqual({ allowed: true });
  });

  it('filters knowledge factors and same-method-as-primary out of the eligible list', async () => {
    const phone = factor('phone', 'possession');
    const fido = factor('fido', 'possession');
    const email = factor('email', 'possession');
    const result = await evaluate({
      actor,
      primaryFactor: makePrimary('password'),
      availableFactors: [
        factor('password', 'knowledge', 'pw-backup'),
        email,
        phone,
        fido,
      ],
    });
    expect(result.allowed).toBe(false);
    // password (knowledge) is filtered; email, phone, fido all survive because primary is password.
    expect((result as { details: { eligibleFactors: AuthMfaRequiredPolicyFactor[] } }).details.eligibleFactors).toEqual([
      { method: 'email', methodId: email.methodId },
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

  it('preserves labels on eligible factors when available', async () => {
    const phone = factor('phone', 'possession', 'phone-1', '+1·····1234');
    const fido = factor('fido', 'possession', 'fido-1', 'YubiKey 5C');
    const result = await evaluate({
      actor,
      primaryFactor: makePrimary('password'),
      availableFactors: [phone, fido],
    });
    expect(result.allowed).toBe(false);
    expect((result as { details: { eligibleFactors: AuthMfaRequiredPolicyFactor[] } }).details.eligibleFactors).toEqual([
      { method: 'phone', methodId: phone.methodId, label: '+1·····1234' },
      { method: 'fido', methodId: fido.methodId, label: 'YubiKey 5C' },
    ]);
  });

  it('omits the label key entirely when the source factor has no label', async () => {
    const phone = factor('phone', 'possession');
    const result = await evaluate({ actor, primaryFactor: makePrimary('password'), availableFactors: [phone] });
    const eligible = (result as { details: { eligibleFactors: AuthMfaRequiredPolicyFactor[] } }).details.eligibleFactors[0]!;
    expect(eligible).toEqual({ method: 'phone', methodId: phone.methodId });
    expect('label' in eligible).toBe(false);
  });

  it('omits the label key when the source factor has an explicit null label', async () => {
    const phone = factor('phone', 'possession', 'phone-1', null);
    const result = await evaluate({ actor, primaryFactor: makePrimary('password'), availableFactors: [phone] });
    const eligible = (result as { details: { eligibleFactors: AuthMfaRequiredPolicyFactor[] } }).details.eligibleFactors[0]!;
    expect(eligible).toEqual({ method: 'phone', methodId: phone.methodId });
    expect('label' in eligible).toBe(false);
  });

  it.each<[AuthenticationFactorMethod, AuthenticationFactorMethod]>([
    ['phone', 'fido'],
    ['fido', 'authenticator'],
    ['authenticator', 'phone'],
  ])('requires MFA when the primary is %s and a different-method (%s) factor is available', async (primary, secondMethod) => {
    const result = await evaluate({
      actor,
      primaryFactor: makePrimary(primary, 'possession'),
      availableFactors: [factor(secondMethod, 'possession')],
    });
    expect(result.allowed).toBe(false);
  });

  it.each<AuthenticationFactorMethod>(['phone', 'fido', 'authenticator'])(
    'excludes same-method factors when the primary is %s (no same-method-twice)',
    async method => {
      const result = await evaluate({
        actor,
        primaryFactor: makePrimary(method, 'possession'),
        availableFactors: [factor(method, 'possession', `${method}-other`)],
      });
      expect(result).toEqual({ allowed: true });
    },
  );
});
