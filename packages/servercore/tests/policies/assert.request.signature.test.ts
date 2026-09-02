import { createHmac } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { isPolicyResultDenied, PolicyService } from '@maroonedsoftware/policies';
import { httpError, HttpError } from '@maroonedsoftware/errors';
import type { Container } from 'injectkit';
import {
  assertRequestSignature,
  DefaultSignaturePolicy,
  REQUIRE_SIGNATURE_POLICY,
  type SignatureOptions,
  type SignaturePolicyContext,
} from '../../src/policies/request.signature.valid.policy.js';

const OPTIONS_KEY = 'webhook';

const DEFAULT_OPTIONS: SignatureOptions = {
  header: 'X-Signature',
  secret: 'test-secret',
  algorithm: 'sha256',
  digest: 'hex',
};

const computeSignature = (opts: SignatureOptions, body: Buffer): string => createHmac(opts.algorithm, opts.secret).update(body).digest(opts.digest);

// Mirrors `BasePolicyService.assert`: evaluate the real DefaultSignaturePolicy and throw an
// httpError(statusCode) on denial, so the HMAC/constant-time logic runs end to end.
const makePolicyService = (): PolicyService => {
  const check = vi.fn((_name: string, context: SignaturePolicyContext) =>
    new DefaultSignaturePolicy().evaluate(context, { now: undefined as never }),
  );
  const assert = vi.fn(async (name: string, context: SignaturePolicyContext, statusCode = 403) => {
    const result = await check(name, context);
    if (isPolicyResultDenied(result)) {
      throw httpError(statusCode).withInternalDetails(result.internalDetails ?? {});
    }
  });
  return { check, assert } as unknown as PolicyService;
};

const makeContainer = (options = DEFAULT_OPTIONS) => {
  const appConfig = new AppConfig({ [OPTIONS_KEY]: options });
  const policyService = makePolicyService();
  const container = { get: vi.fn((token: unknown) => (token === AppConfig ? appConfig : policyService)) } as unknown as Container;
  return { container, policyService };
};

describe('assertRequestSignature', () => {
  it('resolves when the signature is valid', async () => {
    const body = Buffer.from('hello world');
    const { container } = makeContainer();
    const getHeader = vi.fn().mockReturnValue(computeSignature(DEFAULT_OPTIONS, body));

    await expect(assertRequestSignature(container, { rawBody: body, getHeader }, OPTIONS_KEY)).resolves.toBeUndefined();
    expect(getHeader).toHaveBeenCalledWith(DEFAULT_OPTIONS.header);
  });

  it('throws 401 when the signature is invalid', async () => {
    const { container } = makeContainer();

    await expect(assertRequestSignature(container, { rawBody: Buffer.from('body'), getHeader: () => 'bad' }, OPTIONS_KEY)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('treats a missing header as invalid without throwing from timingSafeEqual', async () => {
    const { container } = makeContainer();

    await expect(assertRequestSignature(container, { rawBody: Buffer.from('payload'), getHeader: () => '' }, OPTIONS_KEY)).rejects.toThrow(HttpError);
  });

  it('asserts the default policy with status 401', async () => {
    const body = Buffer.from('hello world');
    const { container, policyService } = makeContainer();

    await assertRequestSignature(container, { rawBody: body, getHeader: () => computeSignature(DEFAULT_OPTIONS, body) }, OPTIONS_KEY);

    expect(policyService.assert).toHaveBeenCalledWith(
      REQUIRE_SIGNATURE_POLICY,
      expect.objectContaining({ rawBody: body, options: DEFAULT_OPTIONS }),
      401,
    );
  });

  it('forwards a custom policy name', async () => {
    const body = Buffer.from('hello world');
    const { container, policyService } = makeContainer();

    await assertRequestSignature(
      container,
      { rawBody: body, getHeader: () => computeSignature(DEFAULT_OPTIONS, body) },
      OPTIONS_KEY,
      'slack.signature.valid',
    );

    expect(policyService.assert).toHaveBeenCalledWith('slack.signature.valid', expect.objectContaining({ rawBody: body }), 401);
  });

  it('works with sha512 / base64 options', async () => {
    const opts: SignatureOptions = { header: 'X-Signature-512', secret: 'my-secret', algorithm: 'sha512', digest: 'base64' };
    const body = Buffer.from('some payload');
    const { container } = makeContainer(opts);

    await expect(
      assertRequestSignature(container, { rawBody: body, getHeader: () => computeSignature(opts, body) }, OPTIONS_KEY),
    ).resolves.toBeUndefined();
  });
});
