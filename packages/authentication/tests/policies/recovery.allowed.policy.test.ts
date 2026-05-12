import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { RecoveryAllowedPolicy, RecoveryAllowedPolicyContext } from '../../src/policies/recovery.allowed.policy.js';
import { RecoveryEligibleChannel } from '../../src/recovery/types.js';

const envelope = { now: DateTime.utc() };
const policy = new RecoveryAllowedPolicy();
const actor = { kind: 'user', actorId: 'user-1' };
const evaluate = (context: RecoveryAllowedPolicyContext) => policy.evaluate(context, envelope);

const email: RecoveryEligibleChannel = { channel: 'email', methodId: 'email-1' };
const phone: RecoveryEligibleChannel = { channel: 'phone', methodId: 'phone-1' };
const recoveryCode: RecoveryEligibleChannel = { channel: 'recoveryCode' };

describe('RecoveryAllowedPolicy', () => {
  it('allows when actor is unknown (prevents user enumeration)', async () => {
    const result = await evaluate({ reason: 'password_reset', eligibleChannels: [] });
    expect(result).toEqual({ allowed: true });
  });

  it('allows password_reset when a verified email or phone is on file', async () => {
    expect(await evaluate({ actor, reason: 'password_reset', eligibleChannels: [email] })).toEqual({ allowed: true });
    expect(await evaluate({ actor, reason: 'password_reset', eligibleChannels: [phone] })).toEqual({ allowed: true });
  });

  it('denies password_reset when no eligible channels exist', async () => {
    const result = await evaluate({ actor, reason: 'password_reset', eligibleChannels: [] });
    expect(result).toEqual({ allowed: false, reason: 'no_eligible_channel' });
  });

  it('allows mfa_recovery when a verified email, phone, or recovery code is on file', async () => {
    expect(await evaluate({ actor, reason: 'mfa_recovery', eligibleChannels: [email] })).toEqual({ allowed: true });
    expect(await evaluate({ actor, reason: 'mfa_recovery', eligibleChannels: [phone] })).toEqual({ allowed: true });
    expect(await evaluate({ actor, reason: 'mfa_recovery', eligibleChannels: [recoveryCode] })).toEqual({ allowed: true });
  });

  it('allows unlock when any verified channel exists', async () => {
    expect(await evaluate({ actor, reason: 'unlock', eligibleChannels: [email] })).toEqual({ allowed: true });
  });

  it('denies full_recovery when neither a recovery code nor an admin approval is present', async () => {
    const result = await evaluate({ actor, reason: 'full_recovery', eligibleChannels: [email, phone] });
    expect(result).toEqual({ allowed: false, reason: 'full_recovery_not_authorised' });
  });

  it('allows full_recovery when a recovery code is on file', async () => {
    const result = await evaluate({ actor, reason: 'full_recovery', eligibleChannels: [recoveryCode] });
    expect(result).toEqual({ allowed: true });
  });

  it('allows full_recovery when recoveryAdminApproved is true', async () => {
    const result = await evaluate({ actor, reason: 'full_recovery', eligibleChannels: [email], recoveryAdminApproved: true });
    expect(result).toEqual({ allowed: true });
  });
});
