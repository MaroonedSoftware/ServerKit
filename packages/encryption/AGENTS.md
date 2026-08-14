# AGENTS.md — @maroonedsoftware/encryption

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Three separable things: `EncryptionProvider`, AES-256-GCM authenticated encryption with both a
direct mode and an envelope (DEK) mode; `KmsProvider`, a pluggable interface for per-id key
lifecycle with rotation and deterministic fingerprints for blind-index lookups; and two PKCE
helpers for OAuth flows.

Reach for `EncryptionProvider` when you hold the key material yourself, and for `KmsProvider` when
key custody, rotation, or per-tenant isolation matters. Do **not** use anything here to hash
passwords — that is `Argon2idPasswordHashProvider` in `@maroonedsoftware/authentication`, which
shares the same `ARGON2ID_DEFAULTS` exported from here so the two cannot drift.

## Install

```bash
pnpm add @maroonedsoftware/encryption
```

Runtime dependencies: `@maroonedsoftware/errors`, `@node-rs/argon2`, `injectkit`, `luxon`. Uses
Node's `crypto`, so Node-only.

## Position in the graph

- **Depends on:** `errors`.
- **Depended on by:** `authentication`.
- **Subpath exports:** none. The package has no `exports` map at all.

## API surface

### Direct and envelope encryption (`src/encryption.provider.ts`)

| Export               | Kind          | Shape                                                                        | Notes                                                                     |
| -------------------- | ------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ARGON2ID_DEFAULTS`  | constant      | `{ memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 }`         | OWASP 2024 Password Storage parameters. **Shared with `authentication`.** |
| `EncryptionProvider` | class         | `@Injectable() new EncryptionProvider(key: Buffer)`                          | Throws `httpError(400)` when the key is not exactly 32 bytes.             |
| `.createKey`         | static method | `(secret: string, salt: Buffer = randomBytes(16)) => Promise<{ key, salt }>` | Argon2id KDF. **Persist the salt** or the data is unrecoverable.          |
| `#encrypt`           | method        | `(plaintext: string) => string`                                              | Master key encrypts directly.                                             |
| `#decrypt`           | method        | `(encoded: string) => string`                                                | —                                                                         |
| `#encryptWithNewDek` | method        | `(plaintext: string) => { encryptedValue: string; encryptedDek: string }`    | Fresh random 256-bit DEK per value; the master key wraps the DEK.         |
| `#decryptWithDek`    | method        | `(encryptedValue: string, encryptedDek: string) => string`                   | —                                                                         |

Ciphertext format is `<iv>:<authTag>:<ciphertext>`, hex-encoded and colon-separated: AES-256-GCM
with a 96-bit random IV and a 128-bit auth tag. The random IV means identical plaintexts produce
different ciphertexts on every call.

### KMS (`src/kms/`)

| Export                   | Kind           | Shape                                                                                                     | Notes                                                           |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `KmsProvider`            | abstract class | `@Injectable()`                                                                                           | The DI token. Four abstract methods.                            |
| `#encryptForId`          | method         | `(id, plaintext: Buffer, context: EncryptionContext, purpose?) => Promise<EncryptResult>`                 | Bootstraps a key for `id` on first use.                         |
| `#decryptForId`          | method         | `(id, ciphertext: Buffer, keyId: string, purpose: string, context: EncryptionContext) => Promise<Buffer>` | `purpose` is **required** here and optional on encrypt.         |
| `#fingerprint`           | method         | `(normalizedValue: NormalizedValue) => Promise<Buffer>`                                                   | Deterministic HMAC for blind-index lookups.                     |
| `#rotateIdKey`           | method         | `(id: string) => Promise<{ newKeyId: string }>`                                                           | The previous active key becomes `retiring`: decrypt-only.       |
| `EncryptResult`          | type           | `{ ciphertext: Buffer; keyId: string }`                                                                   | `keyId` must be stored alongside the ciphertext.                |
| `EncryptionContext`      | type           | `Record<string, string>`                                                                                  | AAD. Authenticated but **not** encrypted. AWS KMS semantics.    |
| `NormalizedValue`        | type           | `Buffer & { readonly __brand: 'NormalizedValue' }`                                                        | Branded so a raw buffer cannot reach `fingerprint` by accident. |
| `asNormalizedValue`      | function       | `(buf: Buffer) => NormalizedValue`                                                                        | A tag, not a canonicaliser — see Gotchas.                       |
| `InMemoryKmsProvider`    | class          | `extends KmsProvider`                                                                                     | Reference implementation for tests and local development.       |
| `InMemoryKmsKeyMaterial` | class          | Key record used by the in-memory provider                                                                 | —                                                               |
| `KmsError`               | class          | `extends ServerkitError`                                                                                  | Base for the three below.                                       |
| `KmsOutageError`         | class          | `extends KmsError`                                                                                        | Backend unavailable.                                            |
| `KeyRetiredError`        | class          | `extends KmsError`                                                                                        | Key fully retired — cannot decrypt.                             |
| `KeyNotFoundError`       | class          | `extends KmsError`                                                                                        | Unknown `keyId`.                                                |

### PKCE (`src/pkce/pkce.ts`)

| Export                | Kind     | Shape                              | Notes                                                               |
| --------------------- | -------- | ---------------------------------- | ------------------------------------------------------------------- |
| `pkceCreateVerifier`  | function | `() => string`                     | 256-bit random, base64url, unpadded — 43 chars. RFC 7636 §4.1.      |
| `pkceCreateChallenge` | function | `(codeVerifier: string) => string` | `S256`: SHA-256, base64url, unpadded. RFC 7636 §4.2. Deterministic. |

## Canonical usage

```typescript
import { EncryptionProvider } from '@maroonedsoftware/encryption';

// Bootstrap from a passphrase — persist the salt on first derivation
const { key, salt } = await EncryptionProvider.createKey(config.masterSecret, await loadSalt());
const encryption = new EncryptionProvider(key);

// Direct
const token = encryption.encrypt(refreshToken);
const plain = encryption.decrypt(token);

// Envelope — store both columns, rotate by re-encrypting only the DEK
const { encryptedValue, encryptedDek } = encryption.encryptWithNewDek(ssn);
```

Envelope encryption with key custody and rotation:

```typescript
import { KmsProvider, asNormalizedValue, type EncryptionContext } from '@maroonedsoftware/encryption';

const context: EncryptionContext = { tenant: tenantId, field: 'ssn' };
const { ciphertext, keyId } = await kms.encryptForId(tenantId, Buffer.from(ssn), context, 'onboarding');

// Blind index — canonicalise first, then tag
const fingerprint = await kms.fingerprint(asNormalizedValue(Buffer.from(email.trim().toLowerCase())));

// Decrypt requires the identical context
const plaintext = await kms.decryptForId(tenantId, ciphertext, keyId, 'support.lookup', context);
```

## Rules for generated code

- Never hard-code or commit key material. Derive with `EncryptionProvider.createKey` from a secret
  supplied by config, or hold keys in a KMS.
- **Persist the salt returned by `createKey` on first derivation** and pass it back on every
  subsequent boot. A fresh salt derives a different key and every existing ciphertext becomes
  unreadable.
- Use envelope mode (`encryptWithNewDek` / `decryptWithDek`) for per-record data you may need to
  rotate. Direct mode makes bulk rotation an O(rows) re-encrypt.
- Store `keyId` alongside every KMS ciphertext. Without it, `decryptForId` cannot be called.
- Pass the **same** `EncryptionContext` on decrypt as on encrypt. It is AAD: a mismatch is a
  decrypt failure, not a warning.
- Canonicalise before `asNormalizedValue` — trim, lowercase, NFC-normalise as appropriate for the
  field. The brand does not do it for you.
- Never put a secret in an `EncryptionContext`. It is authenticated, not encrypted, and travels
  with the ciphertext in the clear.
- Use `ARGON2ID_DEFAULTS` rather than re-declaring Argon2 parameters, so key derivation and
  password hashing stay in step.
- Keep the PKCE verifier client-side and transmit only the challenge.
- For passwords, use `@maroonedsoftware/authentication`, not `createKey`.

## Gotchas

- **`new EncryptionProvider(wrongSizeKey)` throws an `HttpError(400)`.** A configuration mistake at
  bootstrap surfaces as an HTTP status, which is odd out of a request context but is what the code
  does. Catch it at composition time rather than letting a 400 escape from a startup path.
- **`asNormalizedValue` is a type assertion with zero runtime behaviour.** It casts a `Buffer` to
  the branded type; it does not trim, lowercase, or normalise anything. The brand exists to stop
  you passing an *un*normalised buffer by accident, and it cannot actually detect one.
- **Fingerprints are provider-scoped.** The same input yields different fingerprints from different
  providers, so a blind index built against one provider is unusable after a provider swap.
- **`purpose` is optional on `encryptForId` but required on `decryptForId`.** Decrypts are meant to
  be audited; encrypts are not, by default.
- **A retired key throws `KeyRetiredError`, a retiring one still decrypts.** `rotateIdKey` moves the
  previous key to `retiring` (decrypt-only). Full retirement is a separate step that makes old
  ciphertexts permanently unreadable — re-encrypt before you get there.
- **`InMemoryKmsProvider` loses every key on restart.** It is for tests and local development;
  anything encrypted with it is gone when the process ends.
- **The ciphertext format `<iv>:<authTag>:<ciphertext>` is a stored data format**, not an internal
  detail. Changing it makes every existing stored value unreadable.
- **`createKey` is memory-hard by design** (19 MiB, t=2). It is not something to call per request.

## Working inside this package

```
src/
  encryption.provider.ts       ARGON2ID_DEFAULTS, EncryptionProvider (AES-256-GCM, direct + DEK)
  kms/
    kms.provider.ts            KmsProvider, EncryptResult, EncryptionContext, NormalizedValue,
                               asNormalizedValue
    in.memory.kms.provider.ts  InMemoryKmsProvider, InMemoryKmsKeyMaterial
    kms.errors.ts              KmsError, KmsOutageError, KeyRetiredError, KeyNotFoundError
  pkce/pkce.ts                 pkceCreateVerifier, pkceCreateChallenge
  index.ts                     Barrel
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **The ciphertext format is a persistence contract.** Any change to the encoding, the IV length,
  the tag length, or the separator orphans stored data.
- `ARGON2ID_DEFAULTS` is shared with `@maroonedsoftware/authentication`'s password hashing.
  Changing the parameters invalidates existing password hashes there, not just keys here.
- `KmsProvider` must stay an abstract class so it works as an InjectKit token.
- A fresh random IV per encryption is mandatory. GCM with a reused IV under the same key is
  catastrophically broken, not merely weaker.
- `errors` is the only internal dependency; `authentication` depends on this package, so an
  arrow back would be a cycle.

User-visible changes need a changeset in `.changeset/`.
