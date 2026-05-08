import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Container, Identifier } from 'injectkit';
import { DateTime } from 'luxon';
import { Policy, type PolicyEnvelope, type PolicyResult } from '../src/policy.js';
import { BasePolicyService, PolicyRegistryMap } from '../src/policy.service.js';

class StubPolicy extends Policy<{ allow: boolean }> {
  constructor(private readonly impl: (context: { allow: boolean }, envelope: PolicyEnvelope) => Promise<PolicyResult>) {
    super();
  }

  async evaluate(context: { allow: boolean }, envelope: PolicyEnvelope): Promise<PolicyResult> {
    return this.impl(context, envelope);
  }
}

type AppPolicies = {
  example_allowed: { allow: boolean };
};

class TestPolicyService extends BasePolicyService<AppPolicies> {
  protected async buildEnvelope(): Promise<PolicyEnvelope> {
    return { now: DateTime.fromISO('2026-01-01T00:00:00Z', { zone: 'utc' }) };
  }
}

const POLICY_ID = Symbol('policy-id') as unknown as Identifier<Policy>;

describe('BasePolicyService', () => {
  let registry: PolicyRegistryMap;
  let policy: StubPolicy;
  let evaluate: ReturnType<typeof vi.fn>;
  let container: Container;
  let service: TestPolicyService;

  beforeEach(() => {
    evaluate = vi.fn().mockResolvedValue({ allowed: true });
    policy = new StubPolicy(evaluate);
    registry = new PolicyRegistryMap();
    registry.set('example_allowed', POLICY_ID);
    container = { get: vi.fn().mockReturnValue(policy) } as unknown as Container;
    service = new TestPolicyService(container, registry);
  });

  describe('check', () => {
    it('resolves the registered policy and returns its evaluation result', async () => {
      const result = await service.check('example_allowed', { allow: true });
      expect(container.get).toHaveBeenCalledWith(POLICY_ID);
      expect(evaluate).toHaveBeenCalledWith({ allow: true }, { now: expect.anything() });
      expect(result).toEqual({ allowed: true });
    });

    it('passes the envelope from buildEnvelope() to the policy', async () => {
      await service.check('example_allowed', { allow: true });
      const [, envelope] = evaluate.mock.calls[0]!;
      expect(envelope.now.toISO()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('throws when the policy name is not registered', async () => {
      await expect(service.check('unregistered' as 'example_allowed', { allow: true })).rejects.toThrow(/unknown policy: unregistered/);
    });
  });

  describe('assert', () => {
    it('returns normally when the policy allows', async () => {
      evaluate.mockResolvedValue({ allowed: true });
      await expect(service.assert('example_allowed', { allow: true })).resolves.toBeUndefined();
    });

    it('throws HTTP 403 with policy_violation internal details when the policy denies', async () => {
      evaluate.mockResolvedValue({ allowed: false, reason: 'nope', details: { foo: 'bar' } });
      await expect(service.assert('example_allowed', { allow: false })).rejects.toMatchObject({
        statusCode: 403,
        internalDetails: {
          policyName: 'example_allowed',
          reason: 'nope',
          kind: 'policy_violation',
          details: { foo: 'bar' },
        },
      });
    });
  });
});
