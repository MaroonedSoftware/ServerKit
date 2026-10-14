import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { isPolicyResultAllowed, isPolicyResultDenied, type PolicyResult } from '@maroonedsoftware/policies';
import { signRequestBody } from '../../src/policies/request.body.signer.js';
import { DefaultSignaturePolicy, type SignatureOptions } from '../../src/policies/request.signature.valid.policy.js';

const SECRET = 'test-secret';
const NOW = DateTime.fromSeconds(1_760_000_000);
const BODY = Buffer.from('{"event":"example.happened","id":"evt_1"}');

const PLAIN: SignatureOptions = { header: 'Example-Signature', secret: SECRET, algorithm: 'sha256', digest: 'hex' };

const TIMESTAMPED: SignatureOptions = {
  ...PLAIN,
  prefix: 'v1=',
  timestamp: { header: 'Example-Timestamp', maxAgeSeconds: 300 },
};

const verify = (options: SignatureOptions, body: Buffer, headers: Record<string, string>, now = NOW): Promise<PolicyResult> =>
  new DefaultSignaturePolicy().evaluate({ rawBody: body, getHeader: (name: string) => headers[name] ?? '', options }, { now });

const denialReason = (result: PolicyResult): string | undefined => (isPolicyResultDenied(result) ? result.reason : undefined);

/** Sign `body` as a sender configured like `options` would, and return the request headers. */
const signedHeaders = (body: Buffer, at: DateTime = NOW, secret = SECRET): Record<string, string> => {
  const { signature, timestamp } = signRequestBody({ secret, body, timestamp: at, prefix: 'v1=' });
  return { 'Example-Signature': signature, 'Example-Timestamp': timestamp ?? '' };
};

describe('signRequestBody', () => {
  it('defaults to a bare hex HMAC-SHA256 of the body with no timestamp', () => {
    const result = signRequestBody({ secret: SECRET, body: BODY });

    expect(result).toEqual({ signature: createHmac('sha256', SECRET).update(BODY).digest('hex') });
  });

  it('signs "<unix seconds>.<body>" with the prefix when timestamped', () => {
    const result = signRequestBody({ secret: SECRET, body: BODY, timestamp: NOW.plus({ milliseconds: 750 }), prefix: 'v1=' });

    expect(result.timestamp).toBe('1760000000');
    expect(result.signature).toBe(`v1=${createHmac('sha256', SECRET).update(`1760000000.${BODY.toString()}`).digest('hex')}`);
  });

  it('honours algorithm and digest', () => {
    const result = signRequestBody({ secret: SECRET, body: 'payload', algorithm: 'sha512', digest: 'base64' });

    expect(result.signature).toBe(createHmac('sha512', SECRET).update('payload').digest('base64'));
  });

  it('accepts a bare ArrayBuffer body', () => {
    const buffer = new TextEncoder().encode('payload').buffer;

    expect(signRequestBody({ secret: SECRET, body: buffer }).signature).toBe(createHmac('sha256', SECRET).update('payload').digest('hex'));
  });
});

describe('signRequestBody → DefaultSignaturePolicy', () => {
  describe('untimestamped', () => {
    it('round-trips', async () => {
      const { signature } = signRequestBody({ secret: SECRET, body: BODY });

      expect(isPolicyResultAllowed(await verify(PLAIN, BODY, { 'Example-Signature': signature }))).toBe(true);
    });

    it('round-trips with a prefix', async () => {
      const { signature } = signRequestBody({ secret: SECRET, body: BODY, prefix: 'v1=' });

      expect(isPolicyResultAllowed(await verify({ ...PLAIN, prefix: 'v1=' }, BODY, { 'Example-Signature': signature }))).toBe(true);
    });

    it('still verifies a signature computed the original way, without consulting the clock', async () => {
      const legacy = createHmac('sha256', SECRET).update(BODY).digest('hex');
      const result = await new DefaultSignaturePolicy().evaluate(
        { rawBody: BODY, getHeader: (name: string) => (name === PLAIN.header ? legacy : ''), options: PLAIN },
        { now: undefined as never },
      );

      expect(isPolicyResultAllowed(result)).toBe(true);
    });

    it('denies a tampered body', async () => {
      const { signature } = signRequestBody({ secret: SECRET, body: BODY });
      const result = await verify(PLAIN, Buffer.from(`${BODY.toString()} `), { 'Example-Signature': signature });

      expect(denialReason(result)).toBe('invalid_signature');
    });

    it('denies a signature made with the wrong secret', async () => {
      const { signature } = signRequestBody({ secret: 'other-secret', body: BODY });

      expect(denialReason(await verify(PLAIN, BODY, { 'Example-Signature': signature }))).toBe('invalid_signature');
    });

    it('denies a timestamped signature when the receiver expects none', async () => {
      const { signature } = signRequestBody({ secret: SECRET, body: BODY, timestamp: NOW });

      expect(denialReason(await verify(PLAIN, BODY, { 'Example-Signature': signature }))).toBe('invalid_signature');
    });
  });

  describe('timestamped', () => {
    it('round-trips', async () => {
      expect(isPolicyResultAllowed(await verify(TIMESTAMPED, BODY, signedHeaders(BODY)))).toBe(true);
    });

    it('accepts timestamps at the edge of the window in both directions', async () => {
      expect(isPolicyResultAllowed(await verify(TIMESTAMPED, BODY, signedHeaders(BODY, NOW.minus({ seconds: 300 }))))).toBe(true);
      expect(isPolicyResultAllowed(await verify(TIMESTAMPED, BODY, signedHeaders(BODY, NOW.plus({ seconds: 300 }))))).toBe(true);
    });

    it('denies a tampered body', async () => {
      const result = await verify(TIMESTAMPED, Buffer.from('{"event":"other"}'), signedHeaders(BODY));

      expect(denialReason(result)).toBe('invalid_signature');
    });

    it('denies a signature made with the wrong secret', async () => {
      expect(denialReason(await verify(TIMESTAMPED, BODY, signedHeaders(BODY, NOW, 'other-secret')))).toBe('invalid_signature');
    });

    it('denies a timestamp header swapped after signing', async () => {
      const headers = { ...signedHeaders(BODY), 'Example-Timestamp': String(NOW.toSeconds() + 1) };

      expect(denialReason(await verify(TIMESTAMPED, BODY, headers))).toBe('invalid_signature');
    });

    it('denies a stale timestamp', async () => {
      const result = await verify(TIMESTAMPED, BODY, signedHeaders(BODY, NOW.minus({ seconds: 301 })));

      expect(denialReason(result)).toBe('timestamp_out_of_window');
      if (isPolicyResultDenied(result)) {
        expect(result.internalDetails).toMatchObject({ timestamp: '1759999699', now: 1_760_000_000, maxAgeSeconds: 300 });
      }
    });

    it('denies a timestamp too far in the future', async () => {
      expect(denialReason(await verify(TIMESTAMPED, BODY, signedHeaders(BODY, NOW.plus({ seconds: 301 }))))).toBe('timestamp_out_of_window');
    });

    it('denies a missing timestamp header', async () => {
      const { 'Example-Signature': signature } = signedHeaders(BODY);

      expect(denialReason(await verify(TIMESTAMPED, BODY, { 'Example-Signature': signature ?? '' }))).toBe('missing_timestamp');
    });

    it.each(['abc', '1760000000.5', '-1760000000', ' 1760000000', '1e9', '99999999999999999999'])(
      'denies a non-integer timestamp %j',
      async value => {
        const headers = { ...signedHeaders(BODY), 'Example-Timestamp': value };

        expect(denialReason(await verify(TIMESTAMPED, BODY, headers))).toBe('invalid_timestamp');
      },
    );

    it('denies a missing signature header', async () => {
      const { 'Example-Timestamp': timestamp } = signedHeaders(BODY);

      expect(denialReason(await verify(TIMESTAMPED, BODY, { 'Example-Timestamp': timestamp ?? '' }))).toBe('invalid_signature');
    });

    it('keeps the secret out of the denial diagnostics', async () => {
      const result = await verify(TIMESTAMPED, BODY, signedHeaders(BODY, NOW, 'other-secret'));

      expect(isPolicyResultDenied(result)).toBe(true);
      if (isPolicyResultDenied(result)) {
        expect(JSON.stringify(result.internalDetails)).not.toContain(SECRET);
      }
    });
  });
});
