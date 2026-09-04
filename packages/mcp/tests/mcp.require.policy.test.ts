import { describe, it, expect, vi } from 'vitest';
import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { httpError, HttpError } from '@maroonedsoftware/errors';
import type { PolicyService } from '@maroonedsoftware/policies';
import { requireMcpPolicy } from '../src/mcp.require.policy.js';
import { makeAuthenticatedSession } from './helpers.js';

const makePolicyService = (assert = vi.fn(async () => {})) => ({ assert }) as unknown as PolicyService;

describe('requireMcpPolicy', () => {
  describe('session', () => {
    it('throws 401 when the context carries no session', async () => {
      const policies = makePolicyService();

      await expect(requireMcpPolicy({}, policies)).rejects.toThrow(HttpError);
    });

    it('throws 401 when the session is the invalid sentinel', async () => {
      const policies = makePolicyService();

      await expect(requireMcpPolicy({ authenticationSession: invalidAuthenticationSession }, policies)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('never consults the policy service when the session is invalid', async () => {
      const assert = vi.fn(async () => {});
      const policies = makePolicyService(assert);

      await expect(requireMcpPolicy({}, policies, { policy: 'payments.write' })).rejects.toThrow(HttpError);
      expect(assert).not.toHaveBeenCalled();
    });

    it('returns the session so the caller need not narrow it again', async () => {
      const session = makeAuthenticatedSession();

      await expect(requireMcpPolicy({ authenticationSession: session }, makePolicyService())).resolves.toBe(session);
    });
  });

  describe('policy', () => {
    it('asserts no policy by default, since the scaffold session carries no factors', async () => {
      const assert = vi.fn(async () => {});
      const session = makeAuthenticatedSession();

      await requireMcpPolicy({ authenticationSession: session }, makePolicyService(assert));

      expect(assert).not.toHaveBeenCalled();
    });

    it('asserts the named policy against the session', async () => {
      const assert = vi.fn(async () => {});
      const session = makeAuthenticatedSession();

      await requireMcpPolicy({ authenticationSession: session }, makePolicyService(assert), { policy: 'payments.write' });

      expect(assert).toHaveBeenCalledWith('payments.write', { session });
    });

    it('skips the check on an explicit false, same as the default', async () => {
      const assert = vi.fn(async () => {});

      await requireMcpPolicy({ authenticationSession: makeAuthenticatedSession() }, makePolicyService(assert), { policy: false });

      expect(assert).not.toHaveBeenCalled();
    });

    it('propagates the denial thrown by the policy service', async () => {
      const denial = httpError(403).withDetails({ reason: 'forbidden' });
      const assert = vi.fn(async () => {
        throw denial;
      });

      await expect(requireMcpPolicy({ authenticationSession: makeAuthenticatedSession() }, makePolicyService(assert), { policy: 'payments.write' })).rejects.toBe(
        denial,
      );
    });
  });
});
