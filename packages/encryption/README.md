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
- **Passphrase-derived keys** — `EncryptionProvider.createKey(secret)` stretches a passphrase into a 32-byte key with PBKDF2
- **PKCE helpers** — `pkceCreateVerifier` / `pkceCreateChallenge` for OAuth 2.0 PKCE (RFC 7636) flows
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

#### Deriving a key from a passphrase

If you don't have raw key material — only a human-supplied passphrase — use `EncryptionProvider.createKey(secret, salt?)` to stretch it into a 32-byte master key with PBKDF2 (HMAC-SHA-512, 65 535 iterations).

```typescript
// First boot: derive and persist the salt alongside whatever the key protects
const { key, salt } = EncryptionProvider.createKey(process.env.SECRET!);
await persistSalt(salt); // salt is not secret — store it next to ciphertext

// Subsequent boots: re-derive the same key by passing the stored salt back in
const { key } = EncryptionProvider.createKey(process.env.SECRET!, await loadSalt());
const enc = new EncryptionProvider(key);
```

When called without a `salt`, `createKey` generates a fresh random one — you **must** persist it. Without the original salt, previously-encrypted data cannot be recovered.

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

### `EncryptionProvider.createKey(secret: string, salt?: Buffer): { key: Buffer; salt: Buffer }`

Static helper that derives a 32-byte master key from a passphrase using PBKDF2 (HMAC-SHA-512, 65 535 iterations).

| Parameter | Type     | Description                                                                                                            |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `secret`  | `string` | The passphrase to stretch.                                                                                             |
| `salt`    | `Buffer` | Optional 16-byte salt. Omit to generate a fresh random salt; pass the previously-persisted salt to re-derive the same key. |

Returns `{ key, salt }`. **Persist the salt** when generated — without it you cannot re-derive the same key on the next boot, and existing ciphertext becomes unrecoverable. The salt is not secret; store it alongside the ciphertext or in plain config.

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

## KMS provider

For per-id key management with rotation and deterministic fingerprinting (blind-index lookups), this package also ships a `KmsProvider` abstraction and an `InMemoryKmsProvider` reference implementation.

### Concepts

- **Per-id keys.** Each logical owner (a tenant, user, or any domain id) gets its own data encryption key (DEK). Bootstrapped lazily on first encrypt.
- **Envelope encryption.** The DEK encrypts your payload with AES-256-GCM. A root key wraps the DEK at rest.
- **Encryption context.** A `Record<string, string>` bound to every ciphertext as AAD. Must match exactly at decrypt time. Semantics mirror AWS KMS `EncryptionContext` — key order doesn't matter.
- **Rotation.** `rotateIdKey(id)` mints a new active key. The previous active key is marked `retiring` — it still decrypts existing ciphertexts, but new encrypts use the new key.
- **Fingerprint.** HMAC-SHA256 over a normalized value, for blind-index lookups without exposing plaintext.

### Basic encrypt / decrypt

```ts
import { randomBytes } from 'crypto';
import { InMemoryKmsKeyMaterial, InMemoryKmsProvider } from '@maroonedsoftware/encryption';

const kms = new InMemoryKmsProvider(new InMemoryKmsKeyMaterial(randomBytes(32), randomBytes(32)));

const { ciphertext, keyId } = await kms.encryptForId('user-1', Buffer.from('123-45-6789'), {
  tenant: 'acme',
  field: 'ssn',
});

const plaintext = await kms.decryptForId('user-1', ciphertext, keyId, 'reveal-ssn', {
  tenant: 'acme',
  field: 'ssn',
});
```

### Rotation

```ts
const { newKeyId } = await kms.rotateIdKey('user-1');
// Future encryptForId('user-1', ...) uses newKeyId.
// Old ciphertexts still decrypt until the old key is marked `retired`.
```

### Fingerprint (blind index)

```ts
import { asNormalizedValue } from '@maroonedsoftware/encryption';

const normalize = (email: string) => asNormalizedValue(Buffer.from(email.trim().toLowerCase()));

const fp = await kms.fingerprint(normalize('Alice@Example.com'));
```

`NormalizedValue` is a branded `Buffer` — only produced by `asNormalizedValue` — so you can't accidentally fingerprint un-canonicalized input.

### Errors

```ts
import { KeyNotFoundError, KeyRetiredError, KmsError } from '@maroonedsoftware/encryption';

try {
  await kms.decryptForId(id, ciphertext, keyId, 'reveal', context);
} catch (err) {
  if (err instanceof KeyNotFoundError) {
    // keyId not recognized
  } else if (err instanceof KeyRetiredError) {
    // key fully retired, ciphertext must be re-encrypted
  } else if (err instanceof KmsError) {
    // AAD mismatch, tampered ciphertext, etc.
  }
}
```

### `InMemoryKmsProvider`

Reference implementation — all key state and the decrypt audit log live in process memory. Concurrent `rotateIdKey` / bootstrap calls are serialized per id via a promise-chain lock. Suitable for tests and local development; **not for production** (no durability, no replication, root key passed in plaintext).

To plug in your own backend, extend `KmsProvider` and implement `encryptForId`, `decryptForId`, `fingerprint`, and `rotateIdKey`.

### Ciphertext layout

`InMemoryKmsProvider` produces ciphertexts of the form:

```
[ iv (12 bytes) | tag (16 bytes) | aad_len (4 bytes, BE) | aad (json) | body ]
```

The AAD is a sorted-keys JSON serialization of the encryption context — matches AWS KMS semantics so swapping providers later doesn't change decrypt behavior.

---

## PKCE helpers

Stateless helpers for the OAuth 2.0 [Proof Key for Code Exchange](https://datatracker.ietf.org/doc/html/rfc7636) (RFC 7636) flow.

```ts
import { pkceCreateChallenge, pkceCreateVerifier } from '@maroonedsoftware/encryption';

// Authorization request: generate a verifier, derive the challenge
const codeVerifier = pkceCreateVerifier();             // 43-char base64url, 256 bits
const codeChallenge = pkceCreateChallenge(codeVerifier); // SHA-256, base64url
// → redirect user with `code_challenge` + `code_challenge_method=S256`

// Token request (later): send `code_verifier` back; the server recomputes
// pkceCreateChallenge(verifier) and compares it to the stored challenge
```

| Function                              | Returns  | Description                                                                |
| ------------------------------------- | -------- | -------------------------------------------------------------------------- |
| `pkceCreateVerifier()`                | `string` | Fresh 43-character base64url verifier (256 bits of entropy).               |
| `pkceCreateChallenge(codeVerifier)`   | `string` | `S256` challenge — `SHA256(verifier)` base64url-encoded, no padding.       |

For server-side PKCE state storage (binding a value to a challenge for the duration of an auth flow), see `PkceProvider` in [`@maroonedsoftware/authentication`](../authentication/README.md).

---

## Key management tips

- Generate keys with `crypto.randomBytes(32)` and store them as 64-character hex strings in a secrets manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, etc.)
- Never hard-code or commit keys
- To rotate the master key: load all stored DEKs, decrypt each with the old key, re-encrypt with the new key, and save — the encrypted values themselves do not need to change

## License

MIT
