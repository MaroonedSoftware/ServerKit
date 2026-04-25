# @maroonedsoftware/encryption

AES-256-GCM authenticated encryption for ServerKit. Provides both direct encryption and envelope encryption (DEK-based) patterns, with full dependency injection support via [injectkit](https://www.npmjs.com/package/injectkit).

## Installation

```bash
pnpm add @maroonedsoftware/encryption
```

## Features

- **AES-256-GCM** — authenticated encryption that detects tampering via a 128-bit auth tag
- **Random IVs** — a fresh 96-bit IV per encryption means identical plaintexts always produce different ciphertexts
- **Direct encryption** — `encrypt` / `decrypt` for straightforward use cases
- **Envelope encryption** — `encryptWithNewDek` / `decryptWithDek` for per-record key isolation and efficient key rotation
- **DI-friendly** — decorated with `@Injectable()` for injectkit containers

## Usage

### Set up the provider

```typescript
import { EncryptionProvider } from '@maroonedsoftware/encryption';

// The master key must be exactly 32 bytes (256 bits).
// In production, load this from a secrets manager — never hard-code it.
const masterKey = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 64 hex chars

const enc = new EncryptionProvider(masterKey);
```

With an injectkit DI container:

```typescript
registry.register(EncryptionProvider).useFactory(() => {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
  return new EncryptionProvider(key);
}).asSingleton();
```

---

### Direct encryption

Encrypt and decrypt values using the master key directly.

```typescript
const token = enc.encrypt('sensitive-value');
// → "a3f1...:9c2b...:d4e8..." (iv:authTag:ciphertext, all hex)

const plaintext = enc.decrypt(token);
// → "sensitive-value"
```

Use this when all encrypted values share the same key and bulk key rotation is not a concern.

---

### Envelope encryption (DEK-based)

Each value is encrypted with a unique, randomly generated Data Encryption Key (DEK). The DEK is then encrypted with the master key and stored alongside the ciphertext.

```typescript
const { encryptedValue, encryptedDek } = enc.encryptWithNewDek('sensitive-value');
// Store both encryptedValue and encryptedDek in your database

const plaintext = enc.decryptWithDek(encryptedValue, encryptedDek);
// → "sensitive-value"
```

**Why envelope encryption?**

- **Per-record isolation** — a compromised master key exposes plaintext only after additionally compromising each stored DEK
- **Efficient key rotation** — rotating the master key only requires re-encrypting each DEK, not the underlying data
- **Auditability** — the DEK can be revoked independently for a single record

---

## Ciphertext format

All ciphertexts use the format:

```
<iv>:<authTag>:<ciphertext>
```

All three segments are lowercase hex strings, separated by colons:

| Segment      | Length    | Description                                  |
| ------------ | --------- | -------------------------------------------- |
| `iv`         | 24 chars  | 12-byte random initialisation vector (hex)   |
| `authTag`    | 32 chars  | 16-byte GCM authentication tag (hex)         |
| `ciphertext` | variable  | AES-256-GCM encrypted payload (hex)          |

The auth tag ensures that any modification to the ciphertext — however small — causes decryption to throw. Tampered values can never be silently decrypted.

---

## API Reference

### `new EncryptionProvider(key: Buffer)`

Constructs the provider with a 256-bit master key.

| Parameter | Type     | Description                           |
| --------- | -------- | ------------------------------------- |
| `key`     | `Buffer` | A 32-byte (256-bit) master encryption key |

Throws HTTP 400 when the key is not exactly 32 bytes.

---

### `encrypt(plaintext: string): string`

Encrypt a UTF-8 string with the master key.

```typescript
const token = enc.encrypt('my secret');
```

Returns a `<iv>:<authTag>:<ciphertext>` hex string.

---

### `decrypt(encoded: string): string`

Decrypt a ciphertext produced by `encrypt`.

```typescript
const value = enc.decrypt(token);
```

Throws when the format is invalid or the auth tag does not match.

---

### `encryptWithNewDek(plaintext: string): { encryptedValue: string; encryptedDek: string }`

Encrypt a value using a freshly generated DEK, then wrap the DEK with the master key.

```typescript
const { encryptedValue, encryptedDek } = enc.encryptWithNewDek('my secret');
```

Store both values. Pass them to `decryptWithDek` to recover the plaintext.

---

### `decryptWithDek(encryptedValue: string, encryptedDek: string): string`

Decrypt a value encrypted with `encryptWithNewDek`.

```typescript
const value = enc.decryptWithDek(encryptedValue, encryptedDek);
```

Throws when either ciphertext is malformed or any auth tag does not match.

---

## Key management tips

- Generate keys with `crypto.randomBytes(32)` and store them as 64-character hex strings in a secrets manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, etc.)
- Never hard-code or commit keys
- To rotate the master key: load all stored DEKs, decrypt each with the old key, re-encrypt with the new key, and save — the encrypted values themselves do not need to change

## License

MIT
