import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirePolicy } from '../../../src/middleware/router/require.policy.middleware.js';
import {
  invalidAuthenticationSession,
  type AuthenticationFactorKind,
  type AuthenticationFactorMethod,
  type AuthenticationSession,
  type AuthenticationSessionFactor,
} from '@maroonedsoftware/authentication';
import { httpError, HttpError } from '@maroonedsoftware/errors';
import { PolicyService } from '@maroonedsoftware/policies';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';

const makeFactor = (kind: AuthenticationFactorKind, method: AuthenticationFactorMethod): AuthenticationSessionFactor =>
  ({ kind, method, methodId: `${method}-1` }) as unknown as AuthenticationSessionFactor;

const makeValidSession = (factors: AuthenticationSessionFactor[] = []): AuthenticationSession =>
  ({ subject: 'user-1', sessionToken: 'session-token-123', factors, claims: { sub: 'user-1' } }) as unknown as AuthenticationSession;

/** Build a stub `PolicyService` whose `assert` calls a supplied implementation. */
const makePolicyService = (assertImpl: (name: string, ctx: unknown) => Promise<void>): PolicyService => {
  return {
    check: vi.fn(),
    assert: vi.fn(assertImpl),
  } as unknown as PolicyService;
};

describe('requirePolicy', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockCtx: any;
  let mockNext: Next;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNext = vi.fn().mockResolvedValue(undefined);
    mockCtx = {
      authenticationSession: invalidAuthenticationSession,
      container: {
        get: vi.fn(),
      },
    };
  });

  it('returns a middleware function', () => {
    expect(requirePolicy()).toBeTypeOf('function');
  });

  describe('when authenticationSession is invalid', () => {
    it('throws a 401 with WWW-Authenticate: Bearer error="invalid_token"', async () => {
      const middleware = requirePolicy();
      mockCtx.authenticationSession = invalidAuthenticationSession;

      await expect(middleware(mockCtx, mockNext)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('never resolves the policy service when the session is invalid', async () => {
      const middleware = requirePolicy();
      mockCtx.authenticationSession = invalidAuthenticationSession;

      await expect(middleware(mockCtx, mockNext)).rejects.toThrow(HttpError);
      expect(mockCtx.container.get).not.toHaveBeenCalled();
    });
  });

  describe('default policy (auth.session.mfa.satisfied)', () => {
    it('resolves PolicyService and asserts the default policy when policy is omitted', async () => {
      const policyService = makePolicyService(async () => undefined);
      mockCtx.container.get.mockReturnValue(policyService);
      const session = makeValidSession([makeFactor('knowledge', 'password'), makeFactor('possession', 'authenticator')]);
      mockCtx.authenticationSession = session;

      await requirePolicy()(mockCtx, mockNext);

      expect(mockCtx.container.get).toHaveBeenCalledWith(PolicyService);
      expect(policyService.assert).toHaveBeenCalledWith('auth.session.mfa.satisfied', { session });
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('propagates the 403 thrown by PolicyService.assert with policy-supplied headers', async () => {
      const denialError = httpError(403)
        .withDetails({ reason: 'mfa_required' })
        .withHeaders({ 'WWW-Authenticate': 'Bearer error="mfa_required"' });
      const policyService = makePolicyService(async () => {
        throw denialError;
      });
      mockCtx.container.get.mockReturnValue(policyService);
      mockCtx.authenticationSession = makeValidSession([makeFactor('possession', 'oidc')]);

      await expect(requirePolicy()(mockCtx, mockNext)).rejects.toMatchObject({
        statusCode: 403,
        headers: { 'WWW-Authenticate': 'Bearer error="mfa_required"' },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('explicit policy name', () => {
    it('asserts the named policy when one is supplied', async () => {
      const policyService = makePolicyService(async () => undefined);
      mockCtx.container.get.mockReturnValue(policyService);
      const session = makeValidSession([makeFactor('knowledge', 'password'), makeFactor('possession', 'fido')]);
      mockCtx.authenticationSession = session;

      await requirePolicy({ policy: 'auth.session.assurance.level' })(mockCtx, mockNext);

      expect(policyService.assert).toHaveBeenCalledWith('auth.session.assurance.level', { session });
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('forwards a non-MFA policy denial verbatim (e.g. aal2_required header)', async () => {
      const denialError = httpError(403).withHeaders({ 'WWW-Authenticate': 'Bearer error="aal2_required"' });
      const policyService = makePolicyService(async () => {
        throw denialError;
      });
      mockCtx.container.get.mockReturnValue(policyService);
      mockCtx.authenticationSession = makeValidSession([makeFactor('knowledge', 'password')]);

      await expect(requirePolicy({ policy: 'auth.session.assurance.level' })(mockCtx, mockNext)).rejects.toMatchObject({
        statusCode: 403,
        headers: { 'WWW-Authenticate': 'Bearer error="aal2_required"' },
      });
    });

    it('propagates the underlying error when no policy is registered under the requested name', async () => {
      const policyService = makePolicyService(async () => {
        throw new Error('unknown policy: auth.session.bogus');
      });
      mockCtx.container.get.mockReturnValue(policyService);
      mockCtx.authenticationSession = makeValidSession([makeFactor('knowledge', 'password')]);

      await expect(requirePolicy({ policy: 'auth.session.bogus' })(mockCtx, mockNext)).rejects.toThrow(/unknown policy/);
    });
  });

  describe('policy: false', () => {
    it('skips the policy check and calls next() on any valid session', async () => {
      mockCtx.authenticationSession = makeValidSession();

      await requirePolicy({ policy: false })(mockCtx, mockNext);

      expect(mockCtx.container.get).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('still rejects an invalid session even when policy is false', async () => {
      mockCtx.authenticationSession = invalidAuthenticationSession;

      await expect(requirePolicy({ policy: false })(mockCtx, mockNext)).rejects.toMatchObject({
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
      });
    });
  });
});
