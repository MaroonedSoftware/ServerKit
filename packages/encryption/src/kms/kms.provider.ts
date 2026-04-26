import { Injectable } from 'injectkit';

/**
 * A value that has been canonicalized for stable fingerprinting.
 *
 * Branded so raw `Buffer`s / strings cannot be passed to
 * {@link KmsProvider.fingerprint} by accident — only module-owned
 * normalization helpers should produce values of this type.
 *
 * @example
 * ```ts
 * const fp = await kms.fingerprint(asNormalizedValue(Buffer.from(email.trim().toLowerCase())));
 * ```
 */
export type NormalizedValue = Buffer & { readonly __brand: 'NormalizedValue' };

/**
 * Tag a buffer as a {@link NormalizedValue}. The caller is responsible for
 * performing canonicalization (trimming, lowercasing, NFC, etc.) before
 * calling this helper.
 */
export const asNormalizedValue = (buf: Buffer): NormalizedValue => buf as NormalizedValue;

/**
 * Result of a successful encrypt.
 */
export type EncryptResult = {
  /** The encrypted payload. Opaque to callers — format is provider-defined. */
  ciphertext: Buffer;
  /** Identifier of the key used. Must be passed back to `decryptForId`. */
  keyId: string;
};

/**
 * Additional authenticated data bound to a ciphertext.
 *
 * Matches AWS KMS `EncryptionContext` semantics: a string→string map that is
 * authenticated (not encrypted), must match exactly at decrypt time, and is
 * canonicalized key-order-independently. Typical use is tenant/resource
 * binding — e.g. `{ tenant: 'acme', field: 'ssn' }`.
 */
export type EncryptionContext = Record<string, string>;

/**
 * Abstract base for KMS providers.
 *
 * A provider owns the lifecycle of per-id data encryption keys (DEKs) and
 * exposes envelope encrypt/decrypt plus a deterministic fingerprint used for
 * blind lookups. Concrete implementations differ in where they store keys
 * and how they wrap DEKs — see `InMemoryKmsProvider` for the reference
 * implementation suitable for tests and local development.
 */
@Injectable()
export abstract class KmsProvider {
  /**
   * Encrypt `plaintext` under the currently active key for `id`, bootstrapping
   * a new key on first use. The `context` is bound to the ciphertext as AAD
   * and must be supplied verbatim at decrypt time.
   *
   * @param id          Logical owner of the key (e.g. a tenant or user id).
   * @param plaintext   Bytes to encrypt.
   * @param context     Authenticated context bound to the ciphertext.
   * @param purpose     Optional hint describing why this encryption is happening.
   * @returns           The ciphertext and the `keyId` needed to decrypt it.
   */
  abstract encryptForId(id: string, plaintext: Buffer, context: EncryptionContext, purpose?: string): Promise<EncryptResult>;

  /**
   * Decrypt a ciphertext previously produced by {@link encryptForId}.
   *
   * The `context` must match exactly what was supplied at encrypt time — a
   * mismatch throws a `KmsError`. Successful decrypts should be audited by
   * the provider.
   *
   * @param id          Logical owner — must match the id used at encrypt time.
   * @param ciphertext  Bytes returned from a prior encrypt.
   * @param keyId       Key identifier returned from a prior encrypt.
   * @param purpose     Reason for decrypt, recorded in the audit trail.
   * @param context     Authenticated context — must match the encrypt call.
   * @throws `KeyNotFoundError` if `keyId` is unknown.
   * @throws `KeyRetiredError` if the key has been fully retired.
   * @throws `KmsError` on AAD mismatch or any other decrypt failure.
   */
  abstract decryptForId(id: string, ciphertext: Buffer, keyId: string, purpose: string, context: EncryptionContext): Promise<Buffer>;

  /**
   * Produce a deterministic HMAC fingerprint of a normalized value.
   *
   * Used for blind-index lookups (e.g. "find the row whose email hashes to
   * X") without exposing the underlying plaintext. Same input always yields
   * the same output for a given provider; different providers produce
   * different fingerprints for the same input.
   */
  abstract fingerprint(normalizedValue: NormalizedValue): Promise<Buffer>;

  /**
   * Rotate the active key for `id`. The previous active key (if any) is
   * marked `retiring` — it can still decrypt existing ciphertexts but new
   * encrypts use the new key.
   *
   * @returns The `keyId` of the newly created active key.
   */
  abstract rotateIdKey(id: string): Promise<{ newKeyId: string }>;
}
