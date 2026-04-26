---
'@maroonedsoftware/encryption': minor
---

Fold the deprecated `@maroonedsoftware/kms` package into `@maroonedsoftware/encryption`. The `KmsProvider` abstraction, `InMemoryKmsProvider`, `InMemoryKmsKeyMaterial`, fingerprint helpers (`asNormalizedValue`, `NormalizedValue`), result types (`EncryptResult`, `EncryptionContext`), and KMS errors (`KmsError`, `KmsOutageError`, `KeyNotFoundError`, `KeyRetiredError`) are now exported from `@maroonedsoftware/encryption`. Update imports from `@maroonedsoftware/kms` to `@maroonedsoftware/encryption`.
