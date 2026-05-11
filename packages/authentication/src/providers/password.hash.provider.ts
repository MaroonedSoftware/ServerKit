import { Injectable } from 'injectkit';

/** A hashed password and its associated salt — both encoded so they round-trip safely through storage. */
export interface PasswordHashResult {
  /** Encoded password hash (typically base64, or a self-describing PHC string). */
  hash: string;
  /** Encoded salt used to derive the hash. May be empty for self-describing hashes (e.g. Argon2id PHC). */
  salt: string;
}

/**
 * Pluggable password hashing strategy. The bundled default is
 * `Argon2idPasswordHashProvider` — register a subclass to swap in bcrypt,
 * scrypt, or a managed KMS-backed hash.
 *
 * Implementations must guarantee:
 * - {@link hash} produces an encoding from which {@link verify} can recover the
 *   original plaintext check without additional state. Embed any parameters
 *   (iterations, memory cost, …) inside `hash` or `salt` if the algorithm needs
 *   them at verify time.
 * - {@link verify} performs a constant-time comparison to avoid timing side
 *   channels.
 */
@Injectable()
export abstract class PasswordHashProvider {
  /**
   * Hash a plaintext password, generating a fresh salt.
   *
   * @param password - The plaintext password to hash.
   * @returns The encoded hash and salt.
   */
  abstract hash(password: string): Promise<PasswordHashResult>;

  /**
   * Verify a plaintext password against a previously-stored hash and salt.
   *
   * Must be implemented with a constant-time comparison.
   *
   * @param password - The plaintext password to verify.
   * @param hash    - The encoded hash from a prior {@link hash} call.
   * @param salt    - The encoded salt from the same prior {@link hash} call.
   * @returns `true` when the password matches, `false` otherwise.
   */
  abstract verify(password: string, hash: string, salt: string): Promise<boolean>;
}
