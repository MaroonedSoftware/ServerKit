import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  SlackSignaturePolicy,
  SLACK_SIGNATURE_POLICY,
  SLACK_REQUEST_TIMESTAMP_HEADER,
  SLACK_SIGNATURE_HEADER,
  type SlackSignatureOptions,
  type SlackSignaturePolicyContext,
} from '../src/slack.signature.policy.js';
import { isPolicyResultAllowed, isPolicyResultDenied, type PolicyEnvelope } from '@maroonedsoftware/policies';
import type { SlackSignatureFailureReason } from '../src/slack.signature.js';

const SECRET = 'top-secret';
const NOW = 1_700_000_000; // fixed clock for deterministic tests
const FRESH_TS = String(NOW);
const OPTIONS: SlackSignatureOptions = { signingSecret: SECRET };

const envelope: PolicyEnvelope = { now: DateTime.fromSeconds(NOW, { zone: 'utc' }) };

const sign = (rawBody: string, ts: string | number, secret = SECRET) =>
  `v0=${createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')}`;

/** Build a context with a case-sensitive header map (the policy reads the canonical names). */
const makeContext = (
  rawBody: SlackSignaturePolicyContext['rawBody'],
  headers: Record<string, string | undefined>,
  options = OPTIONS,
): SlackSignaturePolicyContext => ({
  rawBody,
  getHeader: name => headers[name] ?? '',
  options,
});

const evaluate = (rawBody: SlackSignaturePolicyContext['rawBody'], ts: string | undefined, signature: string | undefined, options = OPTIONS) =>
  new SlackSignaturePolicy().evaluate(
    makeContext(rawBody, { [SLACK_REQUEST_TIMESTAMP_HEADER]: ts, [SLACK_SIGNATURE_HEADER]: signature }, options),
    envelope,
  );

const expectDenied = async (result: Awaited<ReturnType<typeof evaluate>>, reason: SlackSignatureFailureReason) => {
  expect(isPolicyResultDenied(result)).toBe(true);
  if (isPolicyResultDenied(result)) {
    expect(result.reason).toBe(reason);
  }
};

describe('SlackSignaturePolicy', () => {
  it('is registered under the expected name', () => {
    expect(SLACK_SIGNATURE_POLICY).toBe('slack.signature.valid');
  });

  it('allows when signature, timestamp, and body are valid', async () => {
    const rawBody = '{"hello":"world"}';
    const result = await evaluate(rawBody, FRESH_TS, sign(rawBody, FRESH_TS));

    expect(isPolicyResultAllowed(result)).toBe(true);
  });

  it('accepts a Buffer raw body (converted to UTF-8 text)', async () => {
    const rawBody = '{"hello":"world"}';
    const result = await evaluate(Buffer.from(rawBody, 'utf8'), FRESH_TS, sign(rawBody, FRESH_TS));

    expect(isPolicyResultAllowed(result)).toBe(true);
  });

  it('anchors the replay window to envelope.now', async () => {
    const rawBody = 'x';
    const ts = String(NOW - 60);
    // 60s old, default 5-minute window → allowed when now === NOW
    const fresh = await evaluate(rawBody, ts, sign(rawBody, ts));
    expect(isPolicyResultAllowed(fresh)).toBe(true);

    // Same request evaluated 10 minutes later → stale
    const later: PolicyEnvelope = { now: DateTime.fromSeconds(NOW + 600, { zone: 'utc' }) };
    const stale = await new SlackSignaturePolicy().evaluate(
      makeContext(rawBody, { [SLACK_REQUEST_TIMESTAMP_HEADER]: ts, [SLACK_SIGNATURE_HEADER]: sign(rawBody, ts) }),
      later,
    );
    await expectDenied(stale, 'stale_timestamp');
  });

  it('denies a tampered body with reason invalid_signature', async () => {
    const result = await evaluate('tampered', FRESH_TS, sign('original', FRESH_TS));
    await expectDenied(result, 'invalid_signature');
  });

  it('denies a wrong-secret signature', async () => {
    const rawBody = 'payload';
    const result = await evaluate(rawBody, FRESH_TS, sign(rawBody, FRESH_TS, 'different-secret'));
    await expectDenied(result, 'invalid_signature');
  });

  it('denies a missing timestamp header', async () => {
    const result = await evaluate('x', undefined, 'v0=irrelevant');
    await expectDenied(result, 'missing_timestamp');
  });

  it('denies a non-numeric timestamp', async () => {
    const result = await evaluate('x', 'not-a-number', 'v0=irrelevant');
    await expectDenied(result, 'invalid_timestamp');
  });

  it('denies a missing signature header', async () => {
    const result = await evaluate('x', FRESH_TS, undefined);
    await expectDenied(result, 'missing_signature');
  });

  it('respects a custom signatureMaxAgeSeconds', async () => {
    const ts = String(NOW - 60);
    const tight = await evaluate('x', ts, sign('x', ts), { signingSecret: SECRET, signatureMaxAgeSeconds: 30 });
    await expectDenied(tight, 'stale_timestamp');

    const loose = await evaluate('x', ts, sign('x', ts), { signingSecret: SECRET, signatureMaxAgeSeconds: 120 });
    expect(isPolicyResultAllowed(loose)).toBe(true);
  });

  it('keeps the signing secret out of the denial diagnostics', async () => {
    const result = await evaluate('tampered', FRESH_TS, sign('original', FRESH_TS));
    expect(isPolicyResultDenied(result)).toBe(true);
    if (isPolicyResultDenied(result)) {
      expect(JSON.stringify(result.internalDetails)).not.toContain(SECRET);
      expect(result.internalDetails).toMatchObject({ reason: 'invalid_signature' });
    }
  });
});
