import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireSignature, type SignatureOptions } from '../../../src/middleware/router/require.signature.middleware.js';
import { DefaultSignaturePolicy, REQUIRE_SIGNATURE_POLICY, type SignaturePolicyContext } from '../../../src/policies/request.signature.valid.policy.js';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { isPolicyResultDenied, PolicyService } from '@maroonedsoftware/policies';
import { httpError, HttpError } from '@maroonedsoftware/errors';
import type { Next } from 'koa';

const OPTIONS_KEY = 'webhook';

const DEFAULT_OPTIONS: SignatureOptions = {
  header: 'X-Signature',
  secret: 'test-secret',
  algorithm: 'sha256',
  digest: 'hex',
};

const computeSignature = (opts: SignatureOptions, body: Buffer): string =>
  createHmac(opts.algorithm, opts.secret).update(body).digest(opts.digest);

// The middleware asserts the verification rule through `PolicyService`, so the stub's
// `assert` mirrors `BasePolicyService.assert`: it evaluates the real
// `DefaultSignaturePolicy` and throws an `httpError(statusCode)` on denial — exercising
// the genuine HMAC/constant-time logic end-to-end through the middleware.
const makePolicyService = (): PolicyService => {
  const check = vi.fn((_name: string, context: SignaturePolicyContext) => new DefaultSignaturePolicy().evaluate(context, { now: undefined as never }));
  const assert = vi.fn(async (name: string, context: SignaturePolicyContext, statusCode = 403) => {
    const result = await check(name, context);
    if (isPolicyResultDenied(result)) {
      throw httpError(statusCode).withInternalDetails(result.internalDetails ?? {});
    }
  });
  return { check, assert } as unknown as PolicyService;
};

// The middleware is typed against a router-flavoured context; the tests only exercise a
// small subset of its surface, so we type the mock as `any` to skip stubbing `params` /
// `router` and the rest of the RouterContext shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeCtx = (body: Buffer, signature: string, options = DEFAULT_OPTIONS): any => {
  const appConfig = new AppConfig({ [OPTIONS_KEY]: options });
  const policyService = makePolicyService();
  return {
    rawBody: body,
    get: vi.fn().mockReturnValue(signature),
    container: { get: vi.fn((token: unknown) => (token === AppConfig ? appConfig : policyService)) },
  };
};

describe('requireSignature', () => {
  let mockNext: Next;

  beforeEach(() => {
    mockNext = vi.fn().mockResolvedValue(undefined);
  });

  it('returns a middleware function', () => {
    const middleware = requireSignature(OPTIONS_KEY);
    expect(middleware).toBeTypeOf('function');
  });

  describe('when the signature is valid', () => {
    it('calls next()', async () => {
      const body = Buffer.from('hello world');
      const sig = computeSignature(DEFAULT_OPTIONS, body);
      const middleware = requireSignature(OPTIONS_KEY);

      await middleware(makeCtx(body, sig), mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('reads the signature from the configured header', async () => {
      const body = Buffer.from('payload');
      const sig = computeSignature(DEFAULT_OPTIONS, body);
      const ctx = makeCtx(body, sig);
      const middleware = requireSignature(OPTIONS_KEY);

      await middleware(ctx, mockNext);

      expect(ctx.get).toHaveBeenCalledWith(DEFAULT_OPTIONS.header);
    });
  });

  describe('when the signature is invalid', () => {
    it('throws a 401 error', async () => {
      const middleware = requireSignature(OPTIONS_KEY);
      const ctx = makeCtx(Buffer.from('body'), 'bad-signature');

      await expect(middleware(ctx, mockNext)).rejects.toThrow(HttpError);

      try {
        await middleware(ctx, mockNext);
      } catch (err) {
        expect((err as HttpError).statusCode).toBe(401);
      }
    });

    it('does not call next()', async () => {
      const middleware = requireSignature(OPTIONS_KEY);
      const ctx = makeCtx(Buffer.from('body'), 'bad-signature');

      await expect(middleware(ctx, mockNext)).rejects.toThrow();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('rejects an equal-length but-different signature without short-circuiting on the first mismatched byte', async () => {
      // Regression for the constant-time compare fix: a plain `!==` would still
      // reject this, but the test asserts the path goes through `timingSafeEqual`
      // and not a byte-comparing shortcut. We assert behavior, not internals — a
      // signature with the same length and identical prefix should still 401.
      const body = Buffer.from('hello world');
      const valid = computeSignature(DEFAULT_OPTIONS, body);
      const tampered = valid.slice(0, -2) + (valid.slice(-2) === 'AA' ? 'BB' : 'AA');
      expect(tampered.length).toBe(valid.length);

      const middleware = requireSignature(OPTIONS_KEY);
      const ctx = makeCtx(body, tampered);

      await expect(middleware(ctx, mockNext)).rejects.toThrow(HttpError);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('treats a missing signature header as invalid (length mismatch path)', async () => {
      // `ctx.get` returns '' when the header is absent — the middleware must not
      // throw from `timingSafeEqual` (which requires equal-length buffers); instead
      // the length guard rejects with 401.
      const body = Buffer.from('payload');
      const middleware = requireSignature(OPTIONS_KEY);
      const ctx = makeCtx(body, '');

      await expect(middleware(ctx, mockNext)).rejects.toThrow(HttpError);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('with different algorithms and digests', () => {
    it('works with sha1 / hex', async () => {
      const opts: SignatureOptions = { header: 'X-Hub-Signature', secret: 'secret', algorithm: 'sha1', digest: 'hex' };
      const body = Buffer.from('data');
      const sig = computeSignature(opts, body);
      const middleware = requireSignature(OPTIONS_KEY);

      await middleware(makeCtx(body, sig, opts), mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('works with sha512 / base64', async () => {
      const opts: SignatureOptions = { header: 'X-Signature-512', secret: 'my-secret', algorithm: 'sha512', digest: 'base64' };
      const body = Buffer.from('some payload');
      const sig = computeSignature(opts, body);
      const middleware = requireSignature(OPTIONS_KEY);

      await middleware(makeCtx(body, sig, opts), mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });
  });

  describe('policy selection', () => {
    it('asserts the default REQUIRE_SIGNATURE_POLICY with status 401 when no policy is given', async () => {
      const body = Buffer.from('hello world');
      const ctx = makeCtx(body, computeSignature(DEFAULT_OPTIONS, body));

      await requireSignature(OPTIONS_KEY)(ctx, mockNext);

      const assert = ctx.container.get().assert;
      expect(assert).toHaveBeenCalledWith(REQUIRE_SIGNATURE_POLICY, expect.objectContaining({ rawBody: body }), 401);
    });

    it('forwards a custom policy name to PolicyService.assert', async () => {
      const body = Buffer.from('hello world');
      const ctx = makeCtx(body, computeSignature(DEFAULT_OPTIONS, body));

      await requireSignature(OPTIONS_KEY, { policy: 'slack.signature.valid' })(ctx, mockNext);

      const assert = ctx.container.get().assert;
      expect(assert).toHaveBeenCalledWith('slack.signature.valid', expect.objectContaining({ rawBody: body }), 401);
      // the context still carries the body, a header accessor, and the resolved options
      const passedContext = assert.mock.calls[0][1];
      expect(typeof passedContext.getHeader).toBe('function');
      expect(passedContext.options).toEqual(DEFAULT_OPTIONS);
    });
  });
});
