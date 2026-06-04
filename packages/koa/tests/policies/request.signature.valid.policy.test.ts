import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { DefaultSignaturePolicy, REQUIRE_SIGNATURE_POLICY } from '../../src/policies/request.signature.valid.policy.js';
import type { SignatureOptions } from '../../src/middleware/router/require.signature.middleware.js';
import type { PolicyEnvelope } from '@maroonedsoftware/policies';
import { isPolicyResultAllowed, isPolicyResultDenied } from '@maroonedsoftware/policies';

const OPTIONS: SignatureOptions = {
  header: 'X-Signature',
  secret: 'test-secret',
  algorithm: 'sha256',
  digest: 'hex',
};

const computeSignature = (opts: SignatureOptions, body: Buffer): string =>
  createHmac(opts.algorithm, opts.secret).update(body).digest(opts.digest);

// The policy ignores the envelope; a minimal stub keeps the call type-correct.
const envelope = { now: undefined as never } satisfies PolicyEnvelope;

const evaluate = (body: Buffer, signature: string, options = OPTIONS) =>
  new DefaultSignaturePolicy().evaluate(
    { rawBody: body, getHeader: (name: string) => (name === options.header ? signature : ''), options },
    envelope,
  );

describe('DefaultSignaturePolicy', () => {
  it('is registered under the expected name', () => {
    expect(REQUIRE_SIGNATURE_POLICY).toBe('request.signature.valid');
  });

  it('allows a matching signature', async () => {
    const body = Buffer.from('hello world');
    const result = await evaluate(body, computeSignature(OPTIONS, body));

    expect(isPolicyResultAllowed(result)).toBe(true);
  });

  it('denies a mismatched signature with reason invalid_signature', async () => {
    const result = await evaluate(Buffer.from('body'), 'bad-signature');

    expect(isPolicyResultDenied(result)).toBe(true);
    if (isPolicyResultDenied(result)) {
      expect(result.reason).toBe('invalid_signature');
    }
  });

  it('keeps the secret out of the denial diagnostics', async () => {
    const result = await evaluate(Buffer.from('body'), 'bad-signature');

    expect(isPolicyResultDenied(result)).toBe(true);
    if (isPolicyResultDenied(result)) {
      expect(result.internalDetails).toMatchObject({ message: 'Invalid signature', header: OPTIONS.header, algorithm: OPTIONS.algorithm });
      expect(JSON.stringify(result.internalDetails)).not.toContain(OPTIONS.secret);
    }
  });

  it('denies an equal-length but different signature (constant-time path)', async () => {
    const body = Buffer.from('hello world');
    const valid = computeSignature(OPTIONS, body);
    const tampered = valid.slice(0, -2) + (valid.slice(-2) === 'AA' ? 'BB' : 'AA');
    expect(tampered.length).toBe(valid.length);

    const result = await evaluate(body, tampered);

    expect(isPolicyResultDenied(result)).toBe(true);
  });

  it('denies a missing/empty signature via the length-mismatch guard', async () => {
    const result = await evaluate(Buffer.from('payload'), '');

    expect(isPolicyResultDenied(result)).toBe(true);
  });

  it('works with sha512 / base64', async () => {
    const opts: SignatureOptions = { header: 'X-Signature-512', secret: 'my-secret', algorithm: 'sha512', digest: 'base64' };
    const body = Buffer.from('some payload');
    const result = await evaluate(body, computeSignature(opts, body), opts);

    expect(isPolicyResultAllowed(result)).toBe(true);
  });
});
