import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'crypto';
import { Injectable } from 'injectkit';
import { KeyNotFoundError, KeyRetiredError, KmsError } from './kms.errors.js';
import { EncryptionContext, EncryptResult, KmsProvider, NormalizedValue } from './kms.provider.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const PROVIDER = 'local';
const WRAPPING_KEY_REF = 'local:root';

// Ciphertext layout (app-side): [iv (12) | tag (16) | aad_json_length (4 BE) | aad_json | body].
// AAD is written alongside so decrypt can verify the caller-supplied context
// matches what encrypt saw (provider-side EncryptionContext emulation).

type KeyStatus = 'active' | 'retiring' | 'retired';

type IdKeyRow = {
  id: string;
  keyId: string;
  provider: string;
  wrappedDek: Buffer;
  wrappingKeyRef: string;
  version: number;
  status: KeyStatus;
};

type DecryptAuditEntry = {
  id: string;
  keyId: string;
  purpose: string;
  context: EncryptionContext;
  at: Date;
};

/**
 * Root key material for {@link InMemoryKmsProvider}.
 *
 * - `rootKey` wraps (AES-256-GCM) the per-id data encryption keys at rest.
 * - `hmacKey` seeds the HMAC-SHA256 fingerprint for blind lookups.
 *
 * Both must be exactly 32 bytes. In tests, generate with `randomBytes(32)`.
 * In production-like use, load from a secret manager — never hardcode.
 *
 * @example
 * ```ts
 * const material = new InMemoryKmsKeyMaterial(randomBytes(32), randomBytes(32));
 * const kms = new InMemoryKmsProvider(material);
 * ```
 */
export class InMemoryKmsKeyMaterial {
  constructor(
    readonly rootKey: Buffer,
    readonly hmacKey: Buffer,
  ) {
    if (rootKey.length !== 32) throw new KmsError(`InMemoryKms rootKey must be 32 bytes (got ${rootKey.length})`);
    if (hmacKey.length !== 32) throw new KmsError(`InMemoryKms hmacKey must be 32 bytes (got ${hmacKey.length})`);
  }
}

/**
 * In-memory {@link KmsProvider} suitable for tests and local development.
 *
 * All per-id keys and the decrypt audit trail live in process memory — state
 * is lost when the process exits. Per-id operations are serialized via a
 * promise-chain lock so concurrent `rotateIdKey` / bootstrap calls cannot
 * create duplicate active keys.
 *
 * **Not for production use** — there is no durability, no replication, and
 * the root key must be supplied in plaintext.
 *
 * @example
 * ```ts
 * const kms = new InMemoryKmsProvider(new InMemoryKmsKeyMaterial(rootKey, hmacKey));
 *
 * const { ciphertext, keyId } = await kms.encryptForId('user-1', Buffer.from('ssn'), { tenant: 'acme' });
 * const plaintext = await kms.decryptForId('user-1', ciphertext, keyId, 'reveal', { tenant: 'acme' });
 * ```
 */
@Injectable()
export class InMemoryKmsProvider extends KmsProvider {
  private readonly keysByKeyId = new Map<string, IdKeyRow>();
  private readonly activeKeyIdById = new Map<string, string>();
  private readonly latestVersionById = new Map<string, number>();
  private readonly idLocks = new Map<string, Promise<unknown>>();
  readonly decryptAudit: DecryptAuditEntry[] = [];

  constructor(private readonly keys: InMemoryKmsKeyMaterial) {
    super();
  }

  async encryptForId(id: string, plaintext: Buffer, context: EncryptionContext, _purpose?: string): Promise<EncryptResult> {
    const active = await this.resolveOrBootstrapActiveKey(id);
    if (active.status === 'retired') {
      throw new KeyRetiredError(active.keyId);
    }
    const dek = this.unwrapDek(active.wrappedDek);
    const ciphertext = this.encryptWithDek(dek, plaintext, context);
    return { ciphertext, keyId: active.keyId };
  }

  async decryptForId(id: string, ciphertext: Buffer, keyId: string, purpose: string, context: EncryptionContext): Promise<Buffer> {
    const row = this.keysByKeyId.get(keyId);
    if (!row) throw new KeyNotFoundError(keyId);
    if (row.id !== id) {
      throw new KmsError(`key ${keyId} does not belong to id ${id}`);
    }
    if (row.status === 'retired') throw new KeyRetiredError(keyId);

    const dek = this.unwrapDek(row.wrappedDek);
    const plaintext = this.decryptWithDek(dek, ciphertext, context);

    this.decryptAudit.push({ id, keyId, purpose, context, at: new Date() });

    return plaintext;
  }

  async fingerprint(normalizedValue: NormalizedValue): Promise<Buffer> {
    return createHmac('sha256', this.keys.hmacKey).update(normalizedValue).digest();
  }

  async rotateIdKey(id: string): Promise<{ newKeyId: string }> {
    return await this.withIdLock(id, () => {
      const currentActiveKeyId = this.activeKeyIdById.get(id);
      if (currentActiveKeyId) {
        const current = this.keysByKeyId.get(currentActiveKeyId);
        if (current) current.status = 'retiring';
        this.activeKeyIdById.delete(id);
      }
      const nextVersion = (this.latestVersionById.get(id) ?? 0) + 1;
      const newRow = this.createAndInsertActiveKey(id, nextVersion);
      return { newKeyId: newRow.keyId };
    });
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async resolveOrBootstrapActiveKey(id: string): Promise<IdKeyRow> {
    const existing = this.getActiveRow(id);
    if (existing) return existing;

    return await this.withIdLock(id, () => {
      const inLock = this.getActiveRow(id);
      if (inLock) return inLock;
      return this.createAndInsertActiveKey(id, (this.latestVersionById.get(id) ?? 0) + 1);
    });
  }

  private getActiveRow(id: string): IdKeyRow | undefined {
    const keyId = this.activeKeyIdById.get(id);
    if (!keyId) return undefined;
    return this.keysByKeyId.get(keyId);
  }

  private createAndInsertActiveKey(id: string, version: number): IdKeyRow {
    const dek = randomBytes(32);
    const wrappedDek = this.wrapDek(dek);
    const keyId = `local:${id}:v${version}:${randomUUID()}`;
    const row: IdKeyRow = {
      id,
      keyId,
      provider: PROVIDER,
      wrappedDek,
      wrappingKeyRef: WRAPPING_KEY_REF,
      version,
      status: 'active',
    };
    this.keysByKeyId.set(keyId, row);
    this.activeKeyIdById.set(id, keyId);
    this.latestVersionById.set(id, version);
    return row;
  }

  // Serializes mutations per id so concurrent rotate/bootstrap calls can't
  // race and create two active rows for the same id.
  private async withIdLock<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.idLocks.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const chained = run.catch(() => undefined);
    this.idLocks.set(id, chained);
    try {
      return await run;
    } finally {
      if (this.idLocks.get(id) === chained) this.idLocks.delete(id);
    }
  }

  // Root-key wrap/unwrap: AES-256-GCM over the DEK with no AAD.
  // Format: iv (12) | tag (16) | body.
  private wrapDek(dek: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.keys.rootKey, iv, { authTagLength: TAG_LENGTH });
    const body = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, body]);
  }

  private unwrapDek(wrapped: Buffer): Buffer {
    const iv = wrapped.subarray(0, IV_LENGTH);
    const tag = wrapped.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const body = wrapped.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.keys.rootKey, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }

  private encryptWithDek(dek: Buffer, plaintext: Buffer, context: EncryptionContext): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_LENGTH });
    const aad = Buffer.from(canonicalizeContext(context), 'utf8');
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const aadLen = Buffer.alloc(4);
    aadLen.writeUInt32BE(aad.length, 0);
    return Buffer.concat([iv, tag, aadLen, aad, body]);
  }

  private decryptWithDek(dek: Buffer, ciphertext: Buffer, context: EncryptionContext): Buffer {
    const iv = ciphertext.subarray(0, IV_LENGTH);
    const tag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const aadLen = ciphertext.readUInt32BE(IV_LENGTH + TAG_LENGTH);
    const aadStart = IV_LENGTH + TAG_LENGTH + 4;
    const aad = ciphertext.subarray(aadStart, aadStart + aadLen);
    const body = ciphertext.subarray(aadStart + aadLen);

    const expectedAad = Buffer.from(canonicalizeContext(context), 'utf8');
    if (!aad.equals(expectedAad)) {
      throw new KmsError('AAD mismatch: decrypt context does not match encrypt context');
    }

    const decipher = createDecipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    decipher.setAAD(aad);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }
}

// Sorted-keys JSON for deterministic AAD — matches AWS KMS EncryptionContext semantics.
const canonicalizeContext = (ctx: EncryptionContext): string => {
  const keys = Object.keys(ctx).sort();
  const obj: Record<string, string> = {};
  for (const k of keys) obj[k] = ctx[k]!;
  return JSON.stringify(obj);
};
