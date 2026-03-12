import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireSignature, type SignatureOptions } from '../../../src/middleware/router/require.signature.middleware.js';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { HttpError } from '@maroonedsoftware/errors';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
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

const makeCtx = (body: Buffer, signature: string, options = DEFAULT_OPTIONS): ServerKitContext => {
  const appConfig = new AppConfig({ [OPTIONS_KEY]: options });
  return {
    rawBody: body,
    get: vi.fn().mockReturnValue(signature),
    container: { get: vi.fn().mockReturnValue(appConfig) },
  } as unknown as ServerKitContext;
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
});
