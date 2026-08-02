import { describe, it, expect } from 'vitest';
import type { Container, Identifier } from 'injectkit';
import { DateTime } from 'luxon';
import { AlwaysAllowPolicy } from '../src/always.allow.policy.js';
import { isPolicyResultAllowed, Policy, type PolicyEnvelope } from '../src/policy.js';
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

const POLICY_ID = AlwaysAllowPolicy as unknown as Identifier<Policy>;

describe('AlwaysAllowPolicy', () => {
  it('allows with an empty context', async () => {
    await expect(new AlwaysAllowPolicy().evaluate({}, envelope)).resolves.toEqual({ allowed: true });
  });

  it('allows regardless of the context it is given', async () => {
    const policy = new AlwaysAllowPolicy();
    await expect(policy.evaluate({ value: 'anything' }, envelope)).resolves.toEqual({ allowed: true });
    await expect(policy.evaluate({ value: '' }, envelope)).resolves.toEqual({ allowed: true });
  });

  it('narrows to the allowed branch', async () => {
    const result = await new AlwaysAllowPolicy().evaluate({}, envelope);
    expect(isPolicyResultAllowed(result)).toBe(true);
  });

  it('bypasses the registered policy when swapped in under its name', async () => {
    const registry = new PolicyRegistryMap();
    registry.set('example.gated', POLICY_ID);
    const container = { get: () => new AlwaysAllowPolicy() } as unknown as Container;
    const service = new TestPolicyService(container, registry);

    await expect(service.check('example.gated', { value: 'denied-by-the-real-policy' })).resolves.toEqual({ allowed: true });
    await expect(service.assert('example.gated', { value: 'denied-by-the-real-policy' })).resolves.toBeUndefined();
  });
});
