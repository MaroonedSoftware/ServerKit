# @maroonedsoftware/storage

## 0.3.2

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1

## 0.3.1

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).

## 0.3.0

### Minor Changes

- 49cbebf: Move the S3 and GCS backends behind subpath exports so the core entry no longer statically imports the optional cloud SDKs. Previously importing anything from `@maroonedsoftware/storage` eagerly loaded `@aws-sdk/*`, breaking disk-only consumers that hadn't installed it.

  Breaking: import the cloud providers from their subpaths — `@maroonedsoftware/storage/s3` (`S3StorageProvider`, `S3StorageProviderOptions`) and `@maroonedsoftware/storage/gcs` (`GcsStorageProvider`, `GcsStorageProviderOptions`). The core entry (`StorageProvider`, the error types, `DiskStorageProvider`) is unchanged and pulls in no SDK.

### Patch Changes

- 58eb5b1: Value-import the injected SDK clients (`S3Client`, `Storage`) in the S3 and GCS providers so InjectKit's `design:paramtypes` metadata records the real token. Previously they were type-only imports, leaving the metadata as `Object`, so `container.bind(StorageProvider).to(S3StorageProvider)` could not resolve the client.

## 0.2.0

### Minor Changes

- 55ff178: version bump

## 0.1.0

### Minor Changes

- ac7fd25: Add an object storage package with a DI-friendly `StorageProvider` abstraction and disk, AWS S3, and Google Cloud Storage backends — covering write/read/stat/exists/delete/copy/move/list, inclusive byte-range reads, signed URLs, and typed not-found/access-denied errors. Cloud SDKs are optional peer dependencies.
