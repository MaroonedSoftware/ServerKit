import { vi } from 'vitest';
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import type { Logger } from '@maroonedsoftware/logger';

export const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

/** SPKI DER prefix for an Ed25519 public key — the 32 raw bytes follow it. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export type Keypair = {
  privateKey: KeyObject;
  /** Raw 32-byte public key as hex, matching `DiscordConfig.publicKey`. */
  publicKeyHex: string;
};

/** Generates an Ed25519 keypair and exports the public key as raw hex. */
export const makeKeypair = (): Keypair => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  // Strip the SPKI prefix to recover the 32 raw key bytes.
  const raw = der.subarray(ED25519_SPKI_PREFIX.length);
  return { privateKey, publicKeyHex: raw.toString('hex') };
};

/** Produces the hex Ed25519 signature Discord sends for `timestamp + body`. */
export const signRequest = (privateKey: KeyObject, timestamp: string, rawBody: string): string =>
  edSign(null, Buffer.from(timestamp + rawBody, 'utf8'), privateKey).toString('hex');
