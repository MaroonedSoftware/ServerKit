import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Duration } from 'luxon';
import { PkceProvider } from '../../src/providers/pkce.provider.js';
import { pkceCreateChallenge, pkceCreateVerifier } from '@maroonedsoftware/encryption';
import type { CacheProvider } from '@maroonedsoftware/cache';

const makeCache = (): CacheProvider => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(null),
});

describe('PkceProvider', () => {
  let cache: CacheProvider;
  let provider: PkceProvider;
  const ttl = Duration.fromObject({ minutes: 10 });

  beforeEach(() => {
    cache = makeCache();
    provider = new PkceProvider(cache);
  });

  describe('storeChallenge', () => {
    it('namespaces the cache key with `pkce_` and forwards the value and TTL', async () => {
      await provider.storeChallenge('challenge-1', 'state-payload', ttl);
      expect(cache.set).toHaveBeenCalledWith('pkce_challenge-1', 'state-payload', ttl);
    });
  });

  describe('storeVerifier', () => {
    it('derives the challenge from the verifier and stores under that key', async () => {
      const verifier = pkceCreateVerifier();
      const expectedChallenge = pkceCreateChallenge(verifier);
      await provider.storeVerifier(verifier, 'state', ttl);
      expect(cache.set).toHaveBeenCalledWith(`pkce_${expectedChallenge}`, 'state', ttl);
    });
  });

  describe('getChallenge', () => {
    it('looks up under the namespaced cache key and returns the cached value', async () => {
      cache.get = vi.fn().mockResolvedValue('cached-state');
      const result = await provider.getChallenge('challenge-1');
      expect(cache.get).toHaveBeenCalledWith('pkce_challenge-1');
      expect(result).toBe('cached-state');
    });

    it('returns null when the entry is missing', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      expect(await provider.getChallenge('missing')).toBeNull();
    });
  });

  describe('getVerifier', () => {
    it('looks up the value under the verifier-derived challenge', async () => {
      const verifier = pkceCreateVerifier();
      const expectedChallenge = pkceCreateChallenge(verifier);
      cache.get = vi.fn().mockResolvedValue('state');
      const result = await provider.getVerifier(verifier);
      expect(cache.get).toHaveBeenCalledWith(`pkce_${expectedChallenge}`);
      expect(result).toBe('state');
    });

    it('returns null when no entry exists for the derived challenge', async () => {
      cache.get = vi.fn().mockResolvedValue(null);
      expect(await provider.getVerifier(pkceCreateVerifier())).toBeNull();
    });

    it('round-trips a value stored via storeVerifier', async () => {
      const store = new Map<string, string>();
      cache.set = vi.fn().mockImplementation(async (k: string, v: string) => {
        store.set(k, v);
      });
      cache.get = vi.fn().mockImplementation(async (k: string) => store.get(k) ?? null);

      const verifier = pkceCreateVerifier();
      await provider.storeVerifier(verifier, 'redirect-url', ttl);
      expect(await provider.getVerifier(verifier)).toBe('redirect-url');
    });
  });

  describe('deleteChallenge', () => {
    it('deletes under the namespaced cache key', async () => {
      await provider.deleteChallenge('challenge-1');
      expect(cache.delete).toHaveBeenCalledWith('pkce_challenge-1');
    });
  });

  describe('deleteVerifier', () => {
    it('deletes the entry under the verifier-derived challenge', async () => {
      const verifier = pkceCreateVerifier();
      const expectedChallenge = pkceCreateChallenge(verifier);
      await provider.deleteVerifier(verifier);
      expect(cache.delete).toHaveBeenCalledWith(`pkce_${expectedChallenge}`);
    });
  });
});
