import { describe, it, expect, vi } from 'vitest';
import { invalidAuthenticationSession, type AuthenticationSession } from '@maroonedsoftware/authentication';
import { PolicyService } from '@maroonedsoftware/policies';
import { httpError } from '@maroonedsoftware/errors';
import type { ServerKitModule } from '@maroonedsoftware/servercore';
import { errorPlugin } from '../../../src/plugins/error.plugin.js';
import { serverKitPlugin } from '../../../src/serverkit.plugin.js';
import { serverKitContextPlugin } from '../../../src/plugins/serverkit.context.plugin.js';
import { requirePolicy, type RequirePolicyOptions } from '../../../src/middleware/router/require.policy.middleware.js';
import { ServerKitRouter } from '../../../src/serverkit.router.js';
import { createTestApp } from '../../test.app.js';

const session = { sessionToken: 't', subject: 'alice', factors: [], claims: {} } as unknown as AuthenticationSession;

const build = async (current: AuthenticationSession, options?: RequirePolicyOptions, assert = vi.fn(async () => {})) => {
  const policyService = { assert } as unknown as PolicyService;
  const module: ServerKitModule = { name: 'policies', setup: async registry => void registry.register(PolicyService).useInstance(policyService) };
  const { app, builder } = await createTestApp({
    modules: [module],
    plugins: container => [
      errorPlugin(container),
      serverKitContextPlugin(container),
      serverKitPlugin('test.session', async app =>
        app.addHook('onRequest', async request => {
          request.authenticationSession = current;
        }),
      ),
    ],
  });
  builder.setupRoutes([ServerKitRouter().get('/', requirePolicy(options), async () => 'ok')]);
  return { app, assert };
};

describe('requirePolicy (fastify)', () => {
  it('answers 401 with WWW-Authenticate when the session is invalid', async () => {
    const { app, assert } = await build(invalidAuthenticationSession);

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    expect(assert).not.toHaveBeenCalled();
  });

  it('asserts the default MFA policy with the session and lets the request through', async () => {
    const { app, assert } = await build(session);

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(assert).toHaveBeenCalledWith('auth.session.mfa.satisfied', { session });
  });

  it('asserts a custom policy name', async () => {
    const { app, assert } = await build(session, { policy: 'auth.session.assurance.level' });

    await app.inject({ method: 'GET', url: '/' });

    expect(assert).toHaveBeenCalledWith('auth.session.assurance.level', { session });
  });

  it('skips the policy check with policy: false', async () => {
    const { app, assert } = await build(session, { policy: false });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(assert).not.toHaveBeenCalled();
  });

  it('renders a policy denial with its status and headers', async () => {
    const denial = httpError(403).withDetails({ reason: 'mfa_required' }).withHeaders({ 'www-authenticate': 'Bearer error="mfa_required"' });
    const { app } = await build(
      session,
      undefined,
      vi.fn(async () => Promise.reject(denial)),
    );

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(403);
    expect(response.headers['www-authenticate']).toBe('Bearer error="mfa_required"');
    expect(response.json()).toMatchObject({ details: { reason: 'mfa_required' } });
  });
});
