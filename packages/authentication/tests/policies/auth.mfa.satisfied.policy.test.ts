import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { DefaultMfaSatisfiedPolicy, AuthMfaSatisfiedPolicyContext } from '../../src/policies/auth.mfa.satisfied.policy.js';
import {
  AuthenticationFactorKind,
  AuthenticationFactorMethod,
  AuthenticationSession,
  AuthenticationSessionFactor,
} from '../../src/types.js';

const envelope = { now: DateTime.utc() };
const policy = new DefaultMfaSatisfiedPolicy();

const factor = (method: AuthenticationFactorMethod, kind: AuthenticationFactorKind, methodId = `${method}-1`): AuthenticationSessionFactor => ({
  method,
  methodId,
  kind,
  issuedAt: DateTime.utc(),
  authenticatedAt: DateTime.utc(),
});

const session = (factors: AuthenticationSessionFactor[]): AuthenticationSession => ({
  sessionToken: 'session-token',
  subject: 'user-1',
  issuedAt: DateTime.utc(),
  expiresAt: DateTime.utc().plus({ hours: 1 }),
  lastAccessedAt: DateTime.utc(),
  claims: {},
  factors,
});

const evaluate = (context: AuthMfaSatisfiedPolicyContext) => policy.evaluate(context, envelope);

describe('DefaultMfaSatisfiedPolicy', () => {
  it('allows knowledge + possession', async () => {
    const result = await evaluate({ session: session([factor('password', 'knowledge'), factor('phone', 'possession')]) });
    expect(result).toEqual({ allowed: true });
  });

  it('allows knowledge + biometric', async () => {
    const result = await evaluate({ session: session([factor('password', 'knowledge'), factor('fido', 'biometric')]) });
    expect(result).toEqual({ allowed: true });
  });

  it('allows two distinct possession factors (passwordless MFA)', async () => {
    const result = await evaluate({
      session: session([factor('fido', 'possession', 'fido-1'), factor('authenticator', 'possession', 'auth-1')]),
    });
    expect(result).toEqual({ allowed: true });
  });

  it('denies a single-factor session (e.g. password-only)', async () => {
    const result = await evaluate({ session: session([factor('password', 'knowledge')]) });
    expect(result).toMatchObject({
      allowed: false,
      reason: 'mfa_required',
      headers: { 'WWW-Authenticate': 'Bearer error="mfa_required"' },
    });
  });

  it('denies a single-factor OIDC session by default (consumer must override to grant MFA credit)', async () => {
    const result = await evaluate({ session: session([factor('oidc', 'possession')]) });
    expect(result).toMatchObject({
      allowed: false,
      reason: 'mfa_required',
      headers: { 'WWW-Authenticate': 'Bearer error="mfa_required"' },
    });
  });

  it('denies a session with two knowledge factors (e.g. password + backup password)', async () => {
    const result = await evaluate({
      session: session([factor('password', 'knowledge', 'pw-1'), factor('password', 'knowledge', 'pw-2')]),
    });
    expect(result).toMatchObject({
      allowed: false,
      reason: 'mfa_required',
      headers: { 'WWW-Authenticate': 'Bearer error="mfa_required"' },
    });
  });

  it('denies an empty-factors session', async () => {
    const result = await evaluate({ session: session([]) });
    expect(result).toMatchObject({
      allowed: false,
      reason: 'mfa_required',
      headers: { 'WWW-Authenticate': 'Bearer error="mfa_required"' },
    });
  });
});
