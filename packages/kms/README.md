# @maroonedsoftware/kms

Envelope encryption, key rotation, and deterministic fingerprinting behind a pluggable provider interface. Ships with an in-memory provider for tests and local development.

## Installation

```bash
pnpm add @maroonedsoftware/kms
```

## Concepts

- **Per-id keys.** Each logical owner (a tenant, user, or any domain id) gets its own data encryption key (DEK). Bootstrapped lazily on first encrypt.
- **Envelope encryption.** The DEK encrypts your payload with AES-256-GCM. A root key wraps the DEK at rest.
- **Encryption context.** A `Record<string, string>` bound to every ciphertext as AAD. Must match exactly at decrypt time. Semantics mirror AWS KMS `EncryptionContext` — key order doesn't matter.
- **Rotation.** `rotateIdKey(id)` mints a new active key. The previous active key is marked `retiring` — it still decrypts existing ciphertexts, but new encrypts use the new key.
- **Fingerprint.** HMAC-SHA256 over a normalized value, for blind-index lookups without exposing plaintext.

## Usage

### Basic encrypt / decrypt

```ts
import { randomBytes } from 'crypto';
import { InMemoryKmsKeyMaterial, InMemoryKmsProvider } from '@maroonedsoftware/kms';

const kms = new InMemoryKmsProvider(new InMemoryKmsKeyMaterial(randomBytes(32), randomBytes(32)));

const { ciphertext, keyId } = await kms.encryptForId('user-1', Buffer.from('123-45-6789'), {
  tenant: 'acme',
  field: 'ssn',
});

// Store `ciphertext` and `keyId` alongside the row.

const plaintext = await kms.decryptForId('user-1', ciphertext, keyId, 'reveal-ssn', {
  tenant: 'acme',
  field: 'ssn',
});
```

The encryption context must match byte-for-byte at decrypt time. Tampering with it (or with the ciphertext) throws `KmsError`.

### Rotation

```ts
const { newKeyId } = await kms.rotateIdKey('user-1');
// Future encryptForId('user-1', ...) uses newKeyId.
// Old ciphertexts still decrypt until the old key is marked `retired`.
```

### Fingerprint (blind index)

```ts
import { asNormalizedValue } from '@maroonedsoftware/kms';

const normalize = (email: string) => asNormalizedValue(Buffer.from(email.trim().toLowerCase()));

const fp = await kms.fingerprint(normalize('Alice@Example.com'));
// Store `fp` in a unique-indexed column for lookup without ever revealing the plaintext.
```

`NormalizedValue` is a branded `Buffer` — only produced by `asNormalizedValue` — so you can't accidentally fingerprint un-canonicalized input.

### Errors

```ts
import { KeyNotFoundError, KeyRetiredError, KmsError } from '@maroonedsoftware/kms';

try {
  await kms.decryptForId(id, ciphertext, keyId, 'reveal', context);
} catch (err) {
  if (err instanceof KeyNotFoundError) {
    // keyId not recognized — wrong provider or purged key
  } else if (err instanceof KeyRetiredError) {
    // key fully retired, ciphertext must be re-encrypted
  } else if (err instanceof KmsError) {
    // AAD mismatch, tampered ciphertext, etc.
  }
}
```

## Providers

### `InMemoryKmsProvider`

Reference implementation — all key state and the decrypt audit log live in process memory. Concurrent `rotateIdKey` / bootstrap calls are serialized per id via a promise-chain lock.

Intended for:

- Unit and integration tests
- Local development
- Any scenario where losing keys on restart is acceptable

**Not suitable for production** — no durability, no replication, root key passed in plaintext.

### Writing your own

Extend `KmsProvider` and implement `encryptForId`, `decryptForId`, `fingerprint`, and `rotateIdKey`. Keep the ciphertext wire format and AAD semantics compatible if you want interop with the in-memory provider in tests.

## Ciphertext layout

`InMemoryKmsProvider` produces ciphertexts of the form:

```
[ iv (12 bytes) | tag (16 bytes) | aad_len (4 bytes, BE) | aad (json) | body ]
```

The AAD is a sorted-keys JSON serialization of the encryption context — matches AWS KMS semantics so swapping providers later doesn't change decrypt behavior.

## API

- `KmsProvider` — abstract base, dependency-injectable via InjectKit
- `InMemoryKmsProvider`, `InMemoryKmsKeyMaterial`
- `asNormalizedValue`, `NormalizedValue`, `EncryptResult`, `EncryptionContext`
- `KmsError`, `KmsOutageError`, `KeyNotFoundError`, `KeyRetiredError`

See JSDoc on each symbol for details.
