import { httpError } from '@maroonedsoftware/errors';
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import { Injectable } from 'injectkit';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV — recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag — GCM default
const SEPARATOR = ':';
const ITERATION = 65535;

/**
 * Provides AES-256-GCM authenticated encryption and decryption.
 *
 * Two encryption models are supported:
 *
 * **Direct encryption** — `encrypt` / `decrypt`:
 * The master key encrypts data directly. Simple and fast, but all ciphertexts
 * share the same key, which makes bulk key rotation expensive.
 *
 * **Envelope encryption** — `encryptWithNewDek` / `decryptWithDek`:
 * A random 256-bit Data Encryption Key (DEK) encrypts each value; the master
 * key encrypts the DEK. Enables per-record key rotation by re-encrypting only
 * the DEK, and limits the blast radius of any single key compromise.
 *
 * All ciphertexts use the format `<iv>:<authTag>:<ciphertext>` (hex-encoded,
 * colon-separated). The random IV ensures identical plaintexts produce
 * different ciphertexts on every call.
 *
 * @example
 * ```typescript
 * const key = crypto.randomBytes(32);
 * const enc = new EncryptionProvider(key);
 *
 * // Direct
 * const token = enc.encrypt('secret');
 * enc.decrypt(token); // → 'secret'
 *
 * // Envelope
 * const { encryptedValue, encryptedDek } = enc.encryptWithNewDek('secret');
 * enc.decryptWithDek(encryptedValue, encryptedDek); // → 'secret'
 * ```
 */
@Injectable()
export class EncryptionProvider {
  /**
   * @param key - A 32-byte (256-bit) master encryption key.
   * @throws HTTP 400 when the key is not exactly 32 bytes.
   */
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw httpError(400).withDetails({ key: 'must be 32 bytes' });
    }
  }

  /**
   * Derive a 32-byte master key from a passphrase using PBKDF2 (HMAC-SHA-512,
   * 65,535 iterations).
   *
   * Use this to bootstrap an `EncryptionProvider` from a passphrase rather
   * than from raw key material. The salt must be persisted on first derivation
   * and passed back in on subsequent runs — without it, previously-encrypted
   * data cannot be recovered. The salt itself is not secret and can be stored
   * next to the ciphertext or in plain config.
   *
   * @param secret - The passphrase to stretch.
   * @param salt   - 16-byte salt. Omit on first derivation to get a fresh
   *   random salt back; pass the previously-persisted salt to re-derive the
   *   same key deterministically.
   * @returns `{ key, salt }` — the 32-byte derived key and the salt that
   *   produced it.
   *
   * @example
   * ```typescript
   * // First boot: derive and persist the salt
   * const { key, salt } = EncryptionProvider.createKey(process.env.SECRET!);
   * await persistSalt(salt);
   *
   * // Subsequent boots: re-derive with the stored salt
   * const { key } = EncryptionProvider.createKey(process.env.SECRET!, await loadSalt());
   * const enc = new EncryptionProvider(key);
   * ```
   */
  static createKey(secret: string, salt: Buffer = randomBytes(16)): { key: Buffer; salt: Buffer } {
    const key = pbkdf2Sync(secret, salt, ITERATION, 32, 'sha512');
    return { key, salt };
  }

  /**
   * Encrypt a plaintext string with the master key.
   *
   * @param plaintext - The UTF-8 string to encrypt.
   * @returns A `<iv>:<authTag>:<ciphertext>` hex string.
   */
  encrypt(plaintext: string): string {
    return this.encryptWithKey(plaintext, this.key);
  }

  /**
   * Decrypt a ciphertext produced by {@link encrypt}.
   *
   * @param encoded - The `<iv>:<authTag>:<ciphertext>` hex string.
   * @returns The original plaintext string.
   * @throws When the ciphertext format is invalid or the auth tag does not match
   *   (indicating corruption or use of a different key).
   */
  decrypt(encoded: string): string {
    return this.decryptWithKey(encoded, this.key);
  }

  /**
   * Encrypt a value using a freshly generated Data Encryption Key (DEK),
   * then encrypt the DEK with the master key (envelope encryption).
   *
   * Store both returned strings together. Pass them to {@link decryptWithDek}
   * to recover the original plaintext. The DEK can be re-encrypted with a new
   * master key to rotate keys without re-encrypting the value.
   *
   * @param plaintext - The UTF-8 string to encrypt.
   * @returns `{ encryptedValue, encryptedDek }` — both as hex strings in the
   *   `<iv>:<authTag>:<ciphertext>` format.
   */
  encryptWithNewDek(plaintext: string): { encryptedValue: string; encryptedDek: string } {
    const dek = randomBytes(32);
    const encryptedValue = this.encryptWithKey(plaintext, dek);
    const encryptedDek = this.encryptWithKey(dek.toString('hex'), this.key);
    return { encryptedValue, encryptedDek };
  }

  /**
   * Decrypt a value that was encrypted with {@link encryptWithNewDek}.
   *
   * The master key first decrypts the DEK, then the DEK decrypts the value.
   *
   * @param encryptedValue - The encrypted value from `encryptWithNewDek`.
   * @param encryptedDek   - The encrypted DEK from `encryptWithNewDek`.
   * @returns The original plaintext string.
   * @throws When either ciphertext is malformed or the auth tags do not match.
   */
  decryptWithDek(encryptedValue: string, encryptedDek: string): string {
    const dek = Buffer.from(this.decryptWithKey(encryptedDek, this.key), 'hex');
    return this.decryptWithKey(encryptedValue, dek);
  }

  private encryptWithKey(plaintext: string, key: Buffer): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('hex'), tag.toString('hex'), ciphertext.toString('hex')].join(SEPARATOR);
  }

  private decryptWithKey(encoded: string, key: Buffer): string {
    const parts = encoded.split(SEPARATOR);
    if (parts.length !== 3) {
      throw new Error('EncryptionProvider: invalid ciphertext format');
    }
    const [ivHex, tagHex, ciphertextHex] = parts as [string, string, string];
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
