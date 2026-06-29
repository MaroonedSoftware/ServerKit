import { describe, it, expect } from 'vitest';
import { verifyDiscordSignature, type DiscordSignatureFailureReason } from '../src/discord.signature.js';
import { DiscordError } from '../src/discord.error.js';
import { makeKeypair, signRequest } from './helpers.js';

const NOW = 1_700_000_000; // fixed clock for deterministic tests
const FRESH_TS = String(NOW);

const { privateKey, publicKeyHex } = makeKeypair();

const expectFailure = (fn: () => void, reason: DiscordSignatureFailureReason) => {
  try {
    fn();
    throw new Error(`expected DiscordError with reason "${reason}"`);
  } catch (err) {
    expect(err).toBeInstanceOf(DiscordError);
    expect((err as DiscordError).internalDetails?.reason).toBe(reason);
  }
};

describe('verifyDiscordSignature', () => {
  it('passes when signature, timestamp, and body are valid', () => {
    const rawBody = '{"type":1}';
    expect(() =>
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        rawBody,
        timestamp: FRESH_TS,
        signature: signRequest(privateKey, FRESH_TS, rawBody),
      }),
    ).not.toThrow();
  });

  it('rejects when the body has been tampered with', () => {
    const sigForOriginal = signRequest(privateKey, FRESH_TS, 'original');
    expectFailure(
      () =>
        verifyDiscordSignature({
          publicKey: publicKeyHex,
          rawBody: 'tampered',
          timestamp: FRESH_TS,
          signature: sigForOriginal,
        }),
      'invalid_signature',
    );
  });

  it('rejects when signed with a different key', () => {
    const rawBody = 'payload';
    const other = makeKeypair();
    expectFailure(
      () =>
        verifyDiscordSignature({
          publicKey: publicKeyHex,
          rawBody,
          timestamp: FRESH_TS,
          signature: signRequest(other.privateKey, FRESH_TS, rawBody),
        }),
      'invalid_signature',
    );
  });

  it('rejects when the timestamp is changed (it is part of the signed message)', () => {
    const rawBody = 'payload';
    const sig = signRequest(privateKey, FRESH_TS, rawBody);
    expectFailure(
      () =>
        verifyDiscordSignature({
          publicKey: publicKeyHex,
          rawBody,
          timestamp: String(NOW + 1),
          signature: sig,
        }),
      'invalid_signature',
    );
  });

  it('rejects a missing timestamp', () => {
    expectFailure(
      () =>
        verifyDiscordSignature({
          publicKey: publicKeyHex,
          rawBody: 'x',
          timestamp: undefined,
          signature: 'deadbeef',
        }),
      'missing_timestamp',
    );
  });

  it('rejects an empty-string timestamp', () => {
    expectFailure(
      () =>
        verifyDiscordSignature({
          publicKey: publicKeyHex,
          rawBody: 'x',
          timestamp: '',
          signature: 'deadbeef',
        }),
      'missing_timestamp',
    );
  });

  it('rejects a missing signature', () => {
    expectFailure(
      () =>
        verifyDiscordSignature({
          publicKey: publicKeyHex,
          rawBody: 'x',
          timestamp: FRESH_TS,
          signature: undefined,
        }),
      'missing_signature',
    );
  });

  it('rejects a malformed (odd-length hex) signature without throwing from crypto', () => {
    expectFailure(
      () =>
        verifyDiscordSignature({
          publicKey: publicKeyHex,
          rawBody: 'x',
          timestamp: FRESH_TS,
          signature: 'zzz',
        }),
      'invalid_signature',
    );
  });

  it('rejects a public key that is not 32 bytes', () => {
    expectFailure(
      () =>
        verifyDiscordSignature({
          publicKey: 'abcd',
          rawBody: 'x',
          timestamp: FRESH_TS,
          signature: signRequest(privateKey, FRESH_TS, 'x'),
        }),
      'invalid_public_key',
    );
  });

  describe('optional replay window (maxAgeSeconds)', () => {
    it('does not check freshness by default (no maxAgeSeconds)', () => {
      const staleTs = String(NOW - 10_000);
      const rawBody = 'x';
      expect(() =>
        verifyDiscordSignature({
          publicKey: publicKeyHex,
          rawBody,
          timestamp: staleTs,
          signature: signRequest(privateKey, staleTs, rawBody),
        }),
      ).not.toThrow();
    });

    it('rejects a non-numeric timestamp when a window is set', () => {
      expectFailure(
        () =>
          verifyDiscordSignature({
            publicKey: publicKeyHex,
            rawBody: 'x',
            timestamp: 'not-a-number',
            signature: 'deadbeef',
            maxAgeSeconds: 300,
            now: NOW,
          }),
        'invalid_timestamp',
      );
    });

    it('rejects a stale timestamp when a window is set', () => {
      const staleTs = String(NOW - 301);
      expectFailure(
        () =>
          verifyDiscordSignature({
            publicKey: publicKeyHex,
            rawBody: 'x',
            timestamp: staleTs,
            signature: signRequest(privateKey, staleTs, 'x'),
            maxAgeSeconds: 300,
            now: NOW,
          }),
        'stale_timestamp',
      );
    });

    it('accepts a fresh timestamp within the window', () => {
      const ts = String(NOW - 60);
      const rawBody = 'x';
      expect(() =>
        verifyDiscordSignature({
          publicKey: publicKeyHex,
          rawBody,
          timestamp: ts,
          signature: signRequest(privateKey, ts, rawBody),
          maxAgeSeconds: 300,
          now: NOW,
        }),
      ).not.toThrow();
    });
  });
});
