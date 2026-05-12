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
    policy = new StubPolicy(evaluate as unknown as (context: { allow: boolean }, envelope: PolicyEnvelope) => Promise<PolicyResult>);
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

    it('surfaces result.details on the thrown HttpError so the middleware renders them', async () => {
      evaluate.mockResolvedValue({ allowed: false, reason: 'step_up', details: { kind: 'step_up_required', stepUp: { within: 60 } } });
      await expect(service.assert('example_allowed', { allow: false })).rejects.toMatchObject({
        statusCode: 403,
        details: { kind: 'step_up_required', stepUp: { within: 60 } },
        internalDetails: {
          policyName: 'example_allowed',
          reason: 'step_up',
          kind: 'policy_violation',
        },
      });
    });

    it('routes result.internalDetails to the error internalDetails and keeps details undefined', async () => {
      evaluate.mockResolvedValue({ allowed: false, reason: 'nope', internalDetails: { traceId: 'abc' } });
      const rejection = await service.assert('example_allowed', { allow: false }).catch(error => error);
      expect(rejection).toMatchObject({
        statusCode: 403,
        internalDetails: {
          policyName: 'example_allowed',
          reason: 'nope',
          kind: 'policy_violation',
          traceId: 'abc',
        },
      });
      expect(rejection.details).toBeUndefined();
    });

    it('handles denials carrying both details and internalDetails without overlap', async () => {
      evaluate.mockResolvedValue({
        allowed: false,
        reason: 'weak_password',
        details: { warning: 'too short', suggestions: ['add length'] },
        internalDetails: { zxcvbnScore: 1 },
      });
      await expect(service.assert('example_allowed', { allow: false })).rejects.toMatchObject({
        statusCode: 403,
        details: { warning: 'too short', suggestions: ['add length'] },
        internalDetails: {
          policyName: 'example_allowed',
          reason: 'weak_password',
          kind: 'policy_violation',
          zxcvbnScore: 1,
        },
      });
    });

    it('emits a bare 403 (no details) when the policy returns neither details nor internalDetails', async () => {
      evaluate.mockResolvedValue({ allowed: false, reason: 'deny_list' });
      const rejection = await service.assert('example_allowed', { allow: false }).catch(error => error);
      expect(rejection).toMatchObject({
        statusCode: 403,
        internalDetails: {
          policyName: 'example_allowed',
          reason: 'deny_list',
          kind: 'policy_violation',
        },
      });
      expect(rejection.details).toBeUndefined();
    });
  });
});
