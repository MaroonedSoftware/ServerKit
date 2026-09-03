import { createHmac } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { isPolicyResultDenied, PolicyService } from '@maroonedsoftware/policies';
import { httpError } from '@maroonedsoftware/errors';
import {
  DefaultSignaturePolicy,
  REQUIRE_SIGNATURE_POLICY,
  type ServerKitModule,
  type SignatureOptions,
  type SignaturePolicyContext,
} from '@maroonedsoftware/servercore';
import { bodyParserMiddleware } from '../../src/hooks/body.parser.hook.js';
import { requireSignature } from '../../src/hooks/require.signature.hook.js';
import { createTestApp } from '../test.app.js';

const OPTIONS_KEY = 'webhook';
const OPTIONS: SignatureOptions = { header: 'X-Signature', secret: 'test-secret', algorithm: 'sha256', digest: 'hex' };
const sign = (body: string): string => createHmac(OPTIONS.algorithm, OPTIONS.secret).update(body).digest(OPTIONS.digest);

// Mirrors BasePolicyService.assert over the real DefaultSignaturePolicy.
const makePolicyService = () => {
  const assert = vi.fn(async (name: string, context: SignaturePolicyContext, statusCode = 403) => {
    const result = await new DefaultSignaturePolicy().evaluate(context, { now: undefined as never });
    if (isPolicyResultDenied(result)) throw httpError(statusCode).withInternalDetails(result.internalDetails ?? {});
  });
  return { service: { assert } as unknown as PolicyService, assert };
};

const build = async (policy?: string) => {
  const { service, assert } = makePolicyService();
  const module: ServerKitModule = { name: 'policies', setup: async registry => void registry.register(PolicyService).useInstance(service) };
  const { app } = await createTestApp({ modules: [module], config: new AppConfig({ [OPTIONS_KEY]: OPTIONS }) });
  app.post(
    '/hook',
    { preHandler: [bodyParserMiddleware(['application/json']), requireSignature(OPTIONS_KEY, policy === undefined ? {} : { policy })] },
    async () => 'ok',
  );
  return { app, assert };
};

describe('requireSignature (fastify)', () => {
  it('lets a correctly signed body through', async () => {
    const { app, assert } = await build();
    const body = '{"event":"push"}';

    const response = await app.inject({
      method: 'POST',
      url: '/hook',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(assert).toHaveBeenCalledWith(REQUIRE_SIGNATURE_POLICY, expect.objectContaining({ rawBody: body, options: OPTIONS }), 401);
  });

  it('rejects a wrong signature with 401', async () => {
    const { app } = await build();

    const response = await app.inject({
      method: 'POST',
      url: '/hook',
      headers: { 'content-type': 'application/json', 'x-signature': 'nope' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a missing signature header with 401', async () => {
    const { app } = await build();

    const response = await app.inject({ method: 'POST', url: '/hook', headers: { 'content-type': 'application/json' }, payload: '{}' });

    expect(response.statusCode).toBe(401);
  });

  it('forwards a custom policy name', async () => {
    const { app, assert } = await build('slack.signature.valid');
    const body = '{}';

    await app.inject({ method: 'POST', url: '/hook', headers: { 'content-type': 'application/json', 'x-signature': sign(body) }, payload: body });

    expect(assert).toHaveBeenCalledWith('slack.signature.valid', expect.objectContaining({ rawBody: body }), 401);
  });
});
