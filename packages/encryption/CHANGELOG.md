# @maroonedsoftware/encryption

## 0.4.0

### Minor Changes

- e111278: feat: implement PKCE support in authentication package
  - Introduced `PkceProvider` for cache-backed storage of PKCE state, enabling OAuth 2.0 PKCE flows.
  - Updated `EmailFactorService` and `PhoneFactorService` to return `alreadyRegistered` flag for pending registrations, improving user experience by preventing duplicate notifications.
  - Enhanced README documentation with PKCE usage examples and details.
  - Added unit tests for `PkceProvider` and updated existing tests for email and phone factor services to cover new functionality.

## 0.3.0

### Minor Changes

- e9a18b6: refactor: extend KmsError to inherit from ServerkitError
  - Updated KmsError to extend ServerkitError, enhancing error handling capabilities.
  - This change allows KmsError to utilize the additional properties and methods provided by ServerkitError, improving consistency in error management across the application.

### Patch Changes

- Updated dependencies [7624166]
  - @maroonedsoftware/errors@1.6.0

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
