import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  DiscordSignaturePolicy,
  DISCORD_SIGNATURE_POLICY,
  DISCORD_SIGNATURE_TIMESTAMP_HEADER,
  DISCORD_SIGNATURE_HEADER,
  type DiscordSignatureOptions,
  type DiscordSignaturePolicyContext,
} from '../src/discord.signature.policy.js';
import { isPolicyResultAllowed, isPolicyResultDenied, type PolicyEnvelope } from '@maroonedsoftware/policies';
import type { DiscordSignatureFailureReason } from '../src/discord.signature.js';
import { makeKeypair, signRequest } from './helpers.js';

const NOW = 1_700_000_000;
const FRESH_TS = String(NOW);
const { privateKey, publicKeyHex } = makeKeypair();
const OPTIONS: DiscordSignatureOptions = { publicKey: publicKeyHex };

const envelope: PolicyEnvelope = { now: DateTime.fromSeconds(NOW, { zone: 'utc' }) };

const makeContext = (
  rawBody: DiscordSignaturePolicyContext['rawBody'],
  headers: Record<string, string | undefined>,
  options = OPTIONS,
): DiscordSignaturePolicyContext => ({
  rawBody,
  getHeader: name => headers[name] ?? '',
  options,
});

const evaluate = (
  rawBody: DiscordSignaturePolicyContext['rawBody'],
  ts: string | undefined,
  signature: string | undefined,
  options = OPTIONS,
  env = envelope,
) => new DiscordSignaturePolicy().evaluate(makeContext(rawBody, { [DISCORD_SIGNATURE_TIMESTAMP_HEADER]: ts, [DISCORD_SIGNATURE_HEADER]: signature }, options), env);

const expectDenied = async (result: Awaited<ReturnType<typeof evaluate>>, reason: DiscordSignatureFailureReason) => {
  expect(isPolicyResultDenied(result)).toBe(true);
  if (isPolicyResultDenied(result)) {
    expect(result.reason).toBe(reason);
  }
};

describe('DiscordSignaturePolicy', () => {
  it('is registered under the expected name', () => {
    expect(DISCORD_SIGNATURE_POLICY).toBe('discord.signature.valid');
  });

  it('allows when signature, timestamp, and body are valid', async () => {
    const rawBody = '{"type":1}';
    const result = await evaluate(rawBody, FRESH_TS, signRequest(privateKey, FRESH_TS, rawBody));
    expect(isPolicyResultAllowed(result)).toBe(true);
  });

  it('accepts a Buffer raw body (converted to UTF-8 text)', async () => {
    const rawBody = '{"type":1}';
    const result = await evaluate(Buffer.from(rawBody, 'utf8'), FRESH_TS, signRequest(privateKey, FRESH_TS, rawBody));
    expect(isPolicyResultAllowed(result)).toBe(true);
  });

  it('denies a tampered body with reason invalid_signature', async () => {
    const result = await evaluate('tampered', FRESH_TS, signRequest(privateKey, FRESH_TS, 'original'));
    await expectDenied(result, 'invalid_signature');
  });

  it('denies a signature from a different key', async () => {
    const rawBody = 'payload';
    const other = makeKeypair();
    const result = await evaluate(rawBody, FRESH_TS, signRequest(other.privateKey, FRESH_TS, rawBody));
    await expectDenied(result, 'invalid_signature');
  });

  it('denies a missing timestamp header', async () => {
    const result = await evaluate('x', undefined, 'deadbeef');
    await expectDenied(result, 'missing_timestamp');
  });

  it('denies a missing signature header', async () => {
    const result = await evaluate('x', FRESH_TS, undefined);
    await expectDenied(result, 'missing_signature');
  });

  it('anchors the optional replay window to envelope.now', async () => {
    const rawBody = 'x';
    const ts = String(NOW - 60);
    const options: DiscordSignatureOptions = { publicKey: publicKeyHex, signatureMaxAgeSeconds: 300 };

    // 60s old, 5-minute window → allowed when now === NOW
    const fresh = await evaluate(rawBody, ts, signRequest(privateKey, ts, rawBody), options);
    expect(isPolicyResultAllowed(fresh)).toBe(true);

    // Same request evaluated 10 minutes later → stale
    const later: PolicyEnvelope = { now: DateTime.fromSeconds(NOW + 600, { zone: 'utc' }) };
    const stale = await evaluate(rawBody, ts, signRequest(privateKey, ts, rawBody), options, later);
    await expectDenied(stale, 'stale_timestamp');
  });

  it('keeps the public key out of the denial diagnostics', async () => {
    const result = await evaluate('tampered', FRESH_TS, signRequest(privateKey, FRESH_TS, 'original'));
    expect(isPolicyResultDenied(result)).toBe(true);
    if (isPolicyResultDenied(result)) {
      expect(JSON.stringify(result.internalDetails)).not.toContain(publicKeyHex);
      expect(result.internalDetails).toMatchObject({ reason: 'invalid_signature' });
    }
  });
});
