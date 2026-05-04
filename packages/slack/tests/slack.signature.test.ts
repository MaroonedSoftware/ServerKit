import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySlackSignature, type SlackSignatureFailureReason } from '../src/slack.signature.js';
import { SlackError } from '../src/slack.error.js';

const SECRET = 'top-secret';
const NOW = 1_700_000_000; // fixed clock for deterministic tests
const FRESH_TS = String(NOW);

const sign = (rawBody: string, ts: string | number, secret = SECRET) =>
  `v0=${createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')}`;

const expectFailure = (fn: () => void, reason: SlackSignatureFailureReason) => {
  try {
    fn();
    throw new Error(`expected SlackError with reason "${reason}"`);
  } catch (err) {
    expect(err).toBeInstanceOf(SlackError);
    expect((err as SlackError).internalDetails?.reason).toBe(reason);
  }
};

describe('verifySlackSignature', () => {
  it('passes when signature, timestamp, and body are valid', () => {
    const rawBody = '{"hello":"world"}';
    expect(() =>
      verifySlackSignature({
        signingSecret: SECRET,
        rawBody,
        timestamp: FRESH_TS,
        signature: sign(rawBody, FRESH_TS),
        now: NOW,
      }),
    ).not.toThrow();
  });

  it('rejects when the body has been tampered with', () => {
    const sigForOriginal = sign('original', FRESH_TS);
    expectFailure(
      () =>
        verifySlackSignature({
          signingSecret: SECRET,
          rawBody: 'tampered',
          timestamp: FRESH_TS,
          signature: sigForOriginal,
          now: NOW,
        }),
      'invalid_signature',
    );
  });

  it('rejects when signed with the wrong secret', () => {
    const rawBody = 'payload';
    const sigWithOtherSecret = sign(rawBody, FRESH_TS, 'different-secret');
    expectFailure(
      () =>
        verifySlackSignature({
          signingSecret: SECRET,
          rawBody,
          timestamp: FRESH_TS,
          signature: sigWithOtherSecret,
          now: NOW,
        }),
      'invalid_signature',
    );
  });

  it('rejects a missing timestamp', () => {
    expectFailure(
      () =>
        verifySlackSignature({
          signingSecret: SECRET,
          rawBody: 'x',
          timestamp: undefined,
          signature: 'v0=irrelevant',
          now: NOW,
        }),
      'missing_timestamp',
    );
  });

  it('rejects an empty-string timestamp', () => {
    expectFailure(
      () =>
        verifySlackSignature({
          signingSecret: SECRET,
          rawBody: 'x',
          timestamp: '',
          signature: 'v0=irrelevant',
          now: NOW,
        }),
      'missing_timestamp',
    );
  });

  it('rejects a non-numeric timestamp', () => {
    expectFailure(
      () =>
        verifySlackSignature({
          signingSecret: SECRET,
          rawBody: 'x',
          timestamp: 'not-a-number',
          signature: 'v0=irrelevant',
          now: NOW,
        }),
      'invalid_timestamp',
    );
  });

  it('rejects a timestamp older than the default 5-minute window', () => {
    const staleTs = String(NOW - 301);
    expectFailure(
      () =>
        verifySlackSignature({
          signingSecret: SECRET,
          rawBody: 'x',
          timestamp: staleTs,
          signature: sign('x', staleTs),
          now: NOW,
        }),
      'stale_timestamp',
    );
  });

  it('rejects a timestamp from too far in the future', () => {
    const futureTs = String(NOW + 301);
    expectFailure(
      () =>
        verifySlackSignature({
          signingSecret: SECRET,
          rawBody: 'x',
          timestamp: futureTs,
          signature: sign('x', futureTs),
          now: NOW,
        }),
      'stale_timestamp',
    );
  });

  it('respects a custom maxAgeSeconds', () => {
    const ts = String(NOW - 60);
    // 60s old, but maxAgeSeconds is 30 → reject
    expectFailure(
      () =>
        verifySlackSignature({
          signingSecret: SECRET,
          rawBody: 'x',
          timestamp: ts,
          signature: sign('x', ts),
          maxAgeSeconds: 30,
          now: NOW,
        }),
      'stale_timestamp',
    );
    // Same age, maxAgeSeconds 120 → ok
    expect(() =>
      verifySlackSignature({
        signingSecret: SECRET,
        rawBody: 'x',
        timestamp: ts,
        signature: sign('x', ts),
        maxAgeSeconds: 120,
        now: NOW,
      }),
    ).not.toThrow();
  });

  it('rejects a missing signature', () => {
    expectFailure(
      () =>
        verifySlackSignature({
          signingSecret: SECRET,
          rawBody: 'x',
          timestamp: FRESH_TS,
          signature: undefined,
          now: NOW,
        }),
      'missing_signature',
    );
  });

  it('rejects a signature of differing length without throwing from crypto', () => {
    // timingSafeEqual itself throws on length mismatch — verify we short-circuit.
    expectFailure(
      () =>
        verifySlackSignature({
          signingSecret: SECRET,
          rawBody: 'x',
          timestamp: FRESH_TS,
          signature: 'v0=short',
          now: NOW,
        }),
      'invalid_signature',
    );
  });

  it('uses the real clock when `now` is not provided', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const rawBody = 'live';
    expect(() =>
      verifySlackSignature({
        signingSecret: SECRET,
        rawBody,
        timestamp: ts,
        signature: sign(rawBody, ts),
      }),
    ).not.toThrow();
  });
});
