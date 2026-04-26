# @maroonedsoftware/encryption

## 0.2.0

### Minor Changes

- 4996c32: Fold the deprecated `@maroonedsoftware/kms` package into `@maroonedsoftware/encryption`. The `KmsProvider` abstraction, `InMemoryKmsProvider`, `InMemoryKmsKeyMaterial`, fingerprint helpers (`asNormalizedValue`, `NormalizedValue`), result types (`EncryptResult`, `EncryptionContext`), and KMS errors (`KmsError`, `KmsOutageError`, `KeyNotFoundError`, `KeyRetiredError`) are now exported from `@maroonedsoftware/encryption`. Update imports from `@maroonedsoftware/kms` to `@maroonedsoftware/encryption`.

## 0.1.1

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/errors@1.5.0

## 0.1.0

### Minor Changes

- bcbdcb8: Introduce @maroonedsoftware/encryption package implementing AES-256-GCM authenticated encryption. Adds EncryptionProvider (Injectable) supporting direct encrypt/decrypt and envelope encryption (per-record DEK) with strict 32-byte master key validation.
