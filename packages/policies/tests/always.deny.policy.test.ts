import { describe, it, expect } from 'vitest';
import type { Container, Identifier } from 'injectkit';
import { DateTime } from 'luxon';
import { AlwaysDenyPolicy } from '../src/always.deny.policy.js';
import { isPolicyResultDenied, Policy, type PolicyEnvelope, type PolicyResultDenied } from '../src/policy.js';
import { BasePolicyService, PolicyRegistryMap } from '../src/policy.service.js';

const envelope: PolicyEnvelope = { now: DateTime.fromISO('2026-01-01T00:00:00Z', { zone: 'utc' }) };

type AppPolicies = {
  'example.gated': { value: string };
};

class TestPolicyService extends BasePolicyService<AppPolicies> {
  protected async buildEnvelope(): Promise<PolicyEnvelope> {
    return envelope;
  }
}

const POLICY_ID = AlwaysDenyPolicy as unknown as Identifier<Policy>;

describe('AlwaysDenyPolicy', () => {
  it("denies with reason 'always_deny'", async () => {
    await expect(new AlwaysDenyPolicy().evaluate({}, envelope)).resolves.toEqual({ allowed: false, reason: 'always_deny' });
  });

  it('denies regardless of the context it is given', async () => {
    const policy = new AlwaysDenyPolicy();
    await expect(policy.evaluate({ value: 'anything' }, envelope)).resolves.toMatchObject({ allowed: false, reason: 'always_deny' });
    await expect(policy.evaluate({ value: '' }, envelope)).resolves.toMatchObject({ allowed: false, reason: 'always_deny' });
  });

  it('attaches no details, internalDetails, or headers', async () => {
    const result = (await new AlwaysDenyPolicy().evaluate({}, envelope)) as PolicyResultDenied;
    expect(result.details).toBeUndefined();
    expect(result.internalDetails).toBeUndefined();
    expect(result.headers).toBeUndefined();
  });

  it('narrows to the denied branch', async () => {
    const result = await new AlwaysDenyPolicy().evaluate({}, envelope);
    expect(isPolicyResultDenied(result)).toBe(true);
  });

  it('forces the denial branch when swapped in under a policy name', async () => {
    const registry = new PolicyRegistryMap();
    registry.set('example.gated', POLICY_ID);
    const container = { get: () => new AlwaysDenyPolicy() } as unknown as Container;
    const service = new TestPolicyService(container, registry);

    await expect(service.check('example.gated', { value: 'allowed-by-the-real-policy' })).resolves.toMatchObject({
      allowed: false,
      reason: 'always_deny',
    });
    await expect(service.assert('example.gated', { value: 'allowed-by-the-real-policy' })).rejects.toMatchObject({
      statusCode: 403,
      internalDetails: { policyName: 'example.gated', reason: 'always_deny', kind: 'policy_violation' },
    });
  });
});
