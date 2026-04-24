import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';
import { InMemoryKmsKeyMaterial, InMemoryKmsProvider } from '../src/in-memory.kms.provider.js';
import { asNormalizedValue } from '../src/kms.provider.js';
import { KeyNotFoundError, KeyRetiredError, KmsError } from '../src/types.js';

const makeProvider = () =>
  new InMemoryKmsProvider(new InMemoryKmsKeyMaterial(randomBytes(32), randomBytes(32)));

describe('InMemoryKmsKeyMaterial', () => {
  it('rejects non-32-byte root key', () => {
    expect(() => new InMemoryKmsKeyMaterial(randomBytes(16), randomBytes(32))).toThrow(KmsError);
  });

  it('rejects non-32-byte hmac key', () => {
    expect(() => new InMemoryKmsKeyMaterial(randomBytes(32), randomBytes(16))).toThrow(KmsError);
  });
});

describe('InMemoryKmsProvider', () => {
  let provider: InMemoryKmsProvider;

  beforeEach(() => {
    provider = makeProvider();
  });

  describe('encryptForId / decryptForId', () => {
    it('round-trips plaintext with matching context', async () => {
      const plaintext = Buffer.from('hello world');
      const context = { tenant: 'acme', field: 'ssn' };

      const { ciphertext, keyId } = await provider.encryptForId('user-1', plaintext, context);
      const decrypted = await provider.decryptForId('user-1', ciphertext, keyId, 'test', context);

      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('produces different ciphertext for identical plaintext (random IV)', async () => {
      const plaintext = Buffer.from('same');
      const ctx = { t: 'x' };
      const a = await provider.encryptForId('id', plaintext, ctx);
      const b = await provider.encryptForId('id', plaintext, ctx);
      expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    });

    it('reuses the same active keyId across encrypts for the same id', async () => {
      const a = await provider.encryptForId('id', Buffer.from('a'), {});
      const b = await provider.encryptForId('id', Buffer.from('b'), {});
      expect(a.keyId).toBe(b.keyId);
    });

    it('uses distinct keys per id', async () => {
      const a = await provider.encryptForId('id-a', Buffer.from('x'), {});
      const b = await provider.encryptForId('id-b', Buffer.from('x'), {});
      expect(a.keyId).not.toBe(b.keyId);
    });

    it('rejects decrypt with mismatched context', async () => {
      const { ciphertext, keyId } = await provider.encryptForId('id', Buffer.from('secret'), { tenant: 'acme' });
      await expect(
        provider.decryptForId('id', ciphertext, keyId, 'test', { tenant: 'evil' }),
      ).rejects.toThrow(/AAD mismatch/);
    });

    it('treats context as order-independent (canonicalized AAD)', async () => {
      const { ciphertext, keyId } = await provider.encryptForId('id', Buffer.from('x'), { a: '1', b: '2' });
      const out = await provider.decryptForId('id', ciphertext, keyId, 'test', { b: '2', a: '1' });
      expect(out.toString()).toBe('x');
    });

    it('throws KeyNotFoundError for unknown keyId', async () => {
      await expect(
        provider.decryptForId('id', Buffer.alloc(64), 'local:id:v1:nope', 'test', {}),
      ).rejects.toThrow(KeyNotFoundError);
    });

    it('throws if keyId belongs to a different id', async () => {
      const { ciphertext, keyId } = await provider.encryptForId('id-a', Buffer.from('x'), {});
      await expect(provider.decryptForId('id-b', ciphertext, keyId, 'test', {})).rejects.toThrow(
        /does not belong to id/,
      );
    });

    it('appends to decrypt audit log on success', async () => {
      const { ciphertext, keyId } = await provider.encryptForId('id', Buffer.from('x'), { a: '1' });
      await provider.decryptForId('id', ciphertext, keyId, 'reveal-ssn', { a: '1' });

      expect(provider.decryptAudit).toHaveLength(1);
      expect(provider.decryptAudit[0]).toMatchObject({
        id: 'id',
        keyId,
        purpose: 'reveal-ssn',
        context: { a: '1' },
      });
      expect(provider.decryptAudit[0]!.at).toBeInstanceOf(Date);
    });

    it('does not audit failed decrypts', async () => {
      const { ciphertext, keyId } = await provider.encryptForId('id', Buffer.from('x'), { a: '1' });
      await expect(provider.decryptForId('id', ciphertext, keyId, 'test', { a: '2' })).rejects.toThrow();
      expect(provider.decryptAudit).toHaveLength(0);
    });
  });

  describe('rotateIdKey', () => {
    it('bootstraps a v1 key on first rotate when none exists', async () => {
      const { newKeyId } = await provider.rotateIdKey('fresh');
      expect(newKeyId).toMatch(/^local:fresh:v1:/);
    });

    it('increments version and retires the previous active key', async () => {
      const first = await provider.encryptForId('id', Buffer.from('x'), {});
      const { newKeyId } = await provider.rotateIdKey('id');

      expect(newKeyId).not.toBe(first.keyId);
      expect(newKeyId).toMatch(/^local:id:v2:/);

      // New encrypts use the new key
      const after = await provider.encryptForId('id', Buffer.from('y'), {});
      expect(after.keyId).toBe(newKeyId);

      // Old ciphertext still decrypts (retiring, not retired)
      const out = await provider.decryptForId('id', first.ciphertext, first.keyId, 'test', {});
      expect(out.toString()).toBe('x');
    });

    it('rejects decrypts against a fully retired key', async () => {
      const { ciphertext, keyId } = await provider.encryptForId('id', Buffer.from('x'), {});
      await provider.rotateIdKey('id');

      // Simulate operator retiring the old key by flipping status via the internal map.
      // (Retirement workflow isn't public yet; this asserts the guard fires.)
      const row = (provider as unknown as { keysByKeyId: Map<string, { status: string }> }).keysByKeyId.get(keyId)!;
      row.status = 'retired';

      await expect(provider.decryptForId('id', ciphertext, keyId, 'test', {})).rejects.toThrow(
        KeyRetiredError,
      );
    });

    it('serializes concurrent rotates — no duplicate versions', async () => {
      await provider.encryptForId('id', Buffer.from('seed'), {});
      const results = await Promise.all([
        provider.rotateIdKey('id'),
        provider.rotateIdKey('id'),
        provider.rotateIdKey('id'),
      ]);
      const keyIds = results.map(r => r.newKeyId);
      expect(new Set(keyIds).size).toBe(3);
      const versions = keyIds.map(k => Number(k.match(/:v(\d+):/)![1]));
      expect(versions.sort()).toEqual([2, 3, 4]);
    });

    it('serializes concurrent bootstraps — only one v1 key created', async () => {
      const [a, b, c] = await Promise.all([
        provider.encryptForId('id', Buffer.from('1'), {}),
        provider.encryptForId('id', Buffer.from('2'), {}),
        provider.encryptForId('id', Buffer.from('3'), {}),
      ]);
      expect(a.keyId).toBe(b.keyId);
      expect(b.keyId).toBe(c.keyId);
      expect(a.keyId).toMatch(/^local:id:v1:/);
    });
  });

  describe('fingerprint', () => {
    it('is deterministic for the same input', async () => {
      const value = asNormalizedValue(Buffer.from('user@example.com'));
      const a = await provider.fingerprint(value);
      const b = await provider.fingerprint(value);
      expect(a.equals(b)).toBe(true);
      expect(a).toHaveLength(32);
    });

    it('differs across providers with different hmac keys', async () => {
      const other = makeProvider();
      const value = asNormalizedValue(Buffer.from('user@example.com'));
      const a = await provider.fingerprint(value);
      const b = await other.fingerprint(value);
      expect(a.equals(b)).toBe(false);
    });

    it('differs for different inputs', async () => {
      const a = await provider.fingerprint(asNormalizedValue(Buffer.from('a')));
      const b = await provider.fingerprint(asNormalizedValue(Buffer.from('b')));
      expect(a.equals(b)).toBe(false);
    });
  });
});
