# @maroonedsoftware/storage

## 0.3.3

### Patch Changes

- dfe5304: Security and robustness hardening across the workspace.

  - **appconfig**: reject `__proto__`/`constructor`/`prototype` key segments in `nestKeys` (prototype-pollution guard), isolate config-change listener errors so one throwing listener can't abort a reload, replace arrays on deep-merge (last-wins) instead of concatenating, and make secret/env resolver prefixes non-greedy and always global.
  - **authentication**: atomically claim the refresh-token `jti` (via the new `CacheProvider.add`) to close a refresh-reuse race, pin JWT verification to `RS256`, bound failed OTP/code attempts on the authenticator/email/phone factors (new `maxValidationAttempts`/`maxVerificationAttempts` options, HTTP 429 when exceeded), and split Basic credentials on the first colon only.
  - **cache**: add `CacheProvider.add` (atomic set-if-absent claim primitive) and make `update` apply `XX` so an expired key is not resurrected without a TTL.
  - **discord/slack/telegram/whatsapp**: add a per-request `requestTimeoutMs` (default 10s), redact secret tokens from REST-client logs, and neutralize `@everyone`/`@here`/broadcast mentions in outgoing text. Discord additionally acks multi-reply interactions out of band.
  - **koa**: reject `origin: '*'` combined with `credentials: true`, honor an inbound `X-Request-Id`, bound the binary parser body (new `BinaryParserOptions`, 20MB default, HTTP 413), and resolve wildcard media-type registrations (e.g. `application/*+json`).
  - **multipart**: bound field/parts counts by default (`MAX_FIELDS`/`MAX_PARTS`) so a field flood cannot exhaust memory.
  - **errors**: map Postgres foreign-key violations (23503) to HTTP 409 Conflict instead of 404.
  - **scim**: enforce `userName` required and unique on user PATCH (400/409).
  - **permissions-dsl**: reject reserved namespace names (JS keywords, permission builders, the `model` export) that would otherwise generate uncompilable output.
  - **utilities**: accept UUID versions 6/7/8 in `isUuid`.
  - **storage**: write files atomically (temp file + rename) so a mid-write crash can't leave a truncated file readable as complete.
  - **jobbroker**: reject the pg-boss work handler when a job in the batch fails so retry/dead-letter policies actually apply.
  - **johnny5**: strip dotenv inline comments on unquoted values without corrupting quoted ones.
  - **zod**: fall back to a stable message for issue codes that carry none.

- Updated dependencies [dfe5304]
  - @maroonedsoftware/errors@1.8.0

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
