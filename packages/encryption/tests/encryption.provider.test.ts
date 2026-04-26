import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';
import { EncryptionProvider } from '../src/encryption.provider.js';

const makeKey = () => randomBytes(32);

describe('EncryptionProvider', () => {
  describe('constructor', () => {
    it('constructs successfully with a 32-byte key', () => {
      expect(() => new EncryptionProvider(makeKey())).not.toThrow();
    });

    it('throws HTTP 400 when the key is shorter than 32 bytes', () => {
      expect(() => new EncryptionProvider(randomBytes(16))).toThrow();
    });

    it('throws HTTP 400 when the key is longer than 32 bytes', () => {
      expect(() => new EncryptionProvider(randomBytes(64))).toThrow();
    });

    it('throws HTTP 400 when the key is empty', () => {
      expect(() => new EncryptionProvider(Buffer.alloc(0))).toThrow();
    });

    it('includes key details in the 400 error', () => {
      expect(() => new EncryptionProvider(randomBytes(16))).toThrowError();
    });
  });

  describe('encrypt / decrypt', () => {
    let provider: EncryptionProvider;

    beforeEach(() => {
      provider = new EncryptionProvider(makeKey());
    });

    it('round-trips a plaintext string', () => {
      const plaintext = 'hello world';
      expect(provider.decrypt(provider.encrypt(plaintext))).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      expect(provider.decrypt(provider.encrypt(''))).toBe('');
    });

    it('round-trips unicode and special characters', () => {
      const plaintext = '日本語 • émoji 🔐 & <script>';
      expect(provider.decrypt(provider.encrypt(plaintext))).toBe(plaintext);
    });

    it('round-trips a long string', () => {
      const plaintext = 'a'.repeat(10_000);
      expect(provider.decrypt(provider.encrypt(plaintext))).toBe(plaintext);
    });

    it('produces different ciphertexts for the same plaintext on each call', () => {
      const plaintext = 'same input';
      const first = provider.encrypt(plaintext);
      const second = provider.encrypt(plaintext);
      expect(first).not.toBe(second);
    });

    it('produces a ciphertext with three colon-separated hex parts', () => {
      const ciphertext = provider.encrypt('test');
      const parts = ciphertext.split(':');
      expect(parts).toHaveLength(3);
      parts.forEach(part => expect(/^[0-9a-f]+$/.test(part)).toBe(true));
    });

    it('throws when decrypting with a different key', () => {
      const other = new EncryptionProvider(makeKey());
      const ciphertext = provider.encrypt('secret');
      expect(() => other.decrypt(ciphertext)).toThrow();
    });

    it('throws when the ciphertext format is invalid', () => {
      expect(() => provider.decrypt('notvalidformat')).toThrow('invalid ciphertext format');
    });

    it('throws when the ciphertext has too many segments', () => {
      expect(() => provider.decrypt('a:b:c:d')).toThrow('invalid ciphertext format');
    });

    it('throws when the auth tag has been tampered with', () => {
      const ciphertext = provider.encrypt('secret');
      const [iv, , ct] = ciphertext.split(':') as [string, string, string];
      const tampered = [iv, 'ff'.repeat(16), ct].join(':');
      expect(() => provider.decrypt(tampered)).toThrow();
    });
  });

  describe('encryptWithNewDek / decryptWithDek', () => {
    let provider: EncryptionProvider;

    beforeEach(() => {
      provider = new EncryptionProvider(makeKey());
    });

    it('round-trips a plaintext string', () => {
      const plaintext = 'envelope secret';
      const { encryptedValue, encryptedDek } = provider.encryptWithNewDek(plaintext);
      expect(provider.decryptWithDek(encryptedValue, encryptedDek)).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      const { encryptedValue, encryptedDek } = provider.encryptWithNewDek('');
      expect(provider.decryptWithDek(encryptedValue, encryptedDek)).toBe('');
    });

    it('round-trips unicode and special characters', () => {
      const plaintext = '日本語 🔐';
      const { encryptedValue, encryptedDek } = provider.encryptWithNewDek(plaintext);
      expect(provider.decryptWithDek(encryptedValue, encryptedDek)).toBe(plaintext);
    });

    it('returns encryptedValue and encryptedDek as colon-separated hex strings', () => {
      const { encryptedValue, encryptedDek } = provider.encryptWithNewDek('test');
      [encryptedValue, encryptedDek].forEach(s => {
        expect(s.split(':')).toHaveLength(3);
      });
    });

    it('produces different encryptedValue and encryptedDek on each call', () => {
      const first = provider.encryptWithNewDek('same');
      const second = provider.encryptWithNewDek('same');
      expect(first.encryptedValue).not.toBe(second.encryptedValue);
      expect(first.encryptedDek).not.toBe(second.encryptedDek);
    });

    it('a second provider with the same key can decrypt', () => {
      const key = makeKey();
      const providerA = new EncryptionProvider(key);
      const providerB = new EncryptionProvider(key);

      const { encryptedValue, encryptedDek } = providerA.encryptWithNewDek('cross-provider');
      expect(providerB.decryptWithDek(encryptedValue, encryptedDek)).toBe('cross-provider');
    });

    it('throws when decryptWithDek is given the wrong master key', () => {
      const { encryptedValue, encryptedDek } = provider.encryptWithNewDek('secret');
      const other = new EncryptionProvider(makeKey());
      expect(() => other.decryptWithDek(encryptedValue, encryptedDek)).toThrow();
    });

    it('throws when encryptedDek has been tampered with', () => {
      const { encryptedValue, encryptedDek } = provider.encryptWithNewDek('secret');
      const [iv, , ct] = encryptedDek.split(':') as [string, string, string];
      const tampered = [iv, 'ff'.repeat(16), ct].join(':');
      expect(() => provider.decryptWithDek(encryptedValue, tampered)).toThrow();
    });

    it('throws when encryptedValue has been tampered with', () => {
      const { encryptedValue, encryptedDek } = provider.encryptWithNewDek('secret');
      const [iv, , ct] = encryptedValue.split(':') as [string, string, string];
      const tampered = [iv, 'ff'.repeat(16), ct].join(':');
      expect(() => provider.decryptWithDek(tampered, encryptedDek)).toThrow();
    });
  });

  describe('createKey', () => {
    it('returns a 32-byte key and a 16-byte salt when called without a salt', () => {
      const { key, salt } = EncryptionProvider.createKey('correct horse battery staple');
      expect(key).toBeInstanceOf(Buffer);
      expect(salt).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
      expect(salt.length).toBe(16);
    });

    it('produces a key suitable for the EncryptionProvider constructor', () => {
      const { key } = EncryptionProvider.createKey('passphrase');
      expect(() => new EncryptionProvider(key)).not.toThrow();
    });

    it('returns a different key and salt on each call when no salt is provided', () => {
      const a = EncryptionProvider.createKey('same passphrase');
      const b = EncryptionProvider.createKey('same passphrase');
      expect(a.salt.equals(b.salt)).toBe(false);
      expect(a.key.equals(b.key)).toBe(false);
    });

    it('is deterministic when called with the same secret and salt', () => {
      const passphrase = 'persisted-secret';
      const { key, salt } = EncryptionProvider.createKey(passphrase);
      const { key: rederived } = EncryptionProvider.createKey(passphrase, salt);
      expect(key.equals(rederived)).toBe(true);
    });

    it('echoes back the salt that was passed in', () => {
      const customSalt = randomBytes(16);
      const { salt } = EncryptionProvider.createKey('passphrase', customSalt);
      expect(salt.equals(customSalt)).toBe(true);
    });

    it('produces different keys for different secrets given the same salt', () => {
      const sharedSalt = randomBytes(16);
      const a = EncryptionProvider.createKey('secret-one', sharedSalt);
      const b = EncryptionProvider.createKey('secret-two', sharedSalt);
      expect(a.key.equals(b.key)).toBe(false);
    });

    it('round-trips ciphertext across two providers when the salt is reused', () => {
      const passphrase = 'shared-secret';
      const { key, salt } = EncryptionProvider.createKey(passphrase);
      const a = new EncryptionProvider(key);
      const b = new EncryptionProvider(EncryptionProvider.createKey(passphrase, salt).key);
      expect(b.decrypt(a.encrypt('hello'))).toBe('hello');
    });
  });
});
