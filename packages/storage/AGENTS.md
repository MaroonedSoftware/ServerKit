# AGENTS.md — @maroonedsoftware/storage

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

One `StorageProvider` interface — write, read, stat, exists, delete, copy, move, list, signed URLs —
over three backends: the local filesystem, AWS S3, and Google Cloud Storage. Reads and writes are
streaming, byte-range reads are supported, and failures come back as typed errors rather than as
whatever the SDK threw.

Reach for this whenever an app stores blobs. Do **not** expect a CDN, an image pipeline, or
cross-bucket transfer: `copy` and `move` operate within one backend only.

## Install

```bash
pnpm add @maroonedsoftware/storage

# only for the backend you use
pnpm add @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner
pnpm add @google-cloud/storage
```

Runtime dependencies: `@maroonedsoftware/errors`, `injectkit`, `luxon`, `mime-types`. The cloud SDKs
are all optional peers.

## Position in the graph

- **Depends on:** `errors`.
- **Depended on by:** nothing internal. It is a leaf that applications use directly.
- **Subpath exports:**
  - `.` — the abstraction, the typed errors, and the **dependency-free disk backend**. Loads no
    cloud SDK.
  - `./s3` — `S3StorageProvider`. Pulls in the three optional `@aws-sdk/*` peers.
  - `./gcs` — `GcsStorageProvider`. Pulls in the optional `@google-cloud/storage` peer.

The split is what lets a consumer install one cloud SDK, or none, without the others.

## API surface

### `.` — abstraction

| Export                  | Kind           | Shape                                                                                       | Notes                                                                                  |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `StorageProvider`       | abstract class | `@Injectable()`. Nine abstract methods.                                                     | The DI token. Keys are hierarchical `/`-separated paths (`users/42/avatar.png`).       |
| `#write`                | method         | `(key, body: Readable \| Buffer \| string, options?: StorageWriteOptions) => Promise<void>` | Overwrites.                                                                            |
| `#read`                 | method         | `(key, options?: StorageReadOptions) => Promise<Readable>`                                  | Throws `StorageObjectNotFoundError` when absent.                                       |
| `#stat`                 | method         | `(key) => Promise<StorageObjectMetadata>`                                                   | Throws when absent.                                                                    |
| `#exists`               | method         | `(key) => Promise<boolean>`                                                                 | **Never throws for absence.**                                                          |
| `#delete`               | method         | `(key) => Promise<void>`                                                                    | **Idempotent** — deleting a missing key is a no-op.                                    |
| `#copy` / `#move`       | method         | `(sourceKey, destinationKey) => Promise<void>`                                              | Within this backend only. Overwrites the destination. Throws if the source is missing. |
| `#list`                 | method         | `(options?: StorageListOptions) => Promise<StorageListResult>`                              | **One page.** Loop on `cursor` yourself.                                               |
| `#getSignedUrl`         | method         | `(key, options: SignedUrlOptions) => Promise<string>`                                       | Throws `StorageOperationNotSupportedError` where unsupported.                          |
| `StorageWriteOptions`   | interface      | `{ contentType?, contentLength?, cacheControl?, metadata? }`                                | Backends silently ignore fields they cannot honour.                                    |
| `StorageReadOptions`    | interface      | `{ range?: { start: number; end?: number } }`                                               | Both bounds **inclusive** — HTTP `Range` semantics.                                    |
| `StorageObjectMetadata` | interface      | `{ key, size, contentType?, etag?, lastModified?: DateTime, metadata? }`                    | `lastModified` is a Luxon `DateTime`.                                                  |
| `StorageListOptions`    | interface      | `{ prefix?, limit?, cursor? }`                                                              | `cursor` is opaque and backend-specific.                                               |
| `StorageListResult`     | interface      | `{ objects: StorageObjectMetadata[]; cursor? }`                                             | `cursor` undefined means exhausted.                                                    |
| `SignedUrlOperation`    | type           | `'read' \| 'write'`                                                                         | —                                                                                      |
| `SignedUrlOptions`      | interface      | `{ operation: SignedUrlOperation; expiresIn: Duration; contentType? }`                      | `expiresIn` is a Luxon `Duration`.                                                     |

### `.` — errors

| Export                              | Kind  | Shape                    | Message                                                     |
| ----------------------------------- | ----- | ------------------------ | ----------------------------------------------------------- |
| `StorageError`                      | class | `extends ServerkitError` | Base — catch this for any storage failure.                  |
| `StorageObjectNotFoundError`        | class | `(key, options?)`        | `storage object '<key>' not found`                          |
| `StorageAccessDeniedError`          | class | `(key, options?)`        | `access denied for storage object '<key>'`                  |
| `StorageOperationNotSupportedError` | class | `(operation, options?)`  | `storage operation '<op>' is not supported by this backend` |

### `.` — disk backend

| Export                       | Kind  | Shape                                                         | Notes                                                              |
| ---------------------------- | ----- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `DiskStorageProviderOptions` | class | `new DiskStorageProviderOptions({ rootDir, publicBaseUrl? })` | A **class**, not an interface, so it is a valid InjectKit token.   |
| `DiskStorageProvider`        | class | `@Injectable() new DiskStorageProvider(options)`              | Nested keys create intermediate directories. **No user metadata.** |

`getSignedUrl` on disk returns `${publicBaseUrl}/${key}` when `publicBaseUrl` is set, and otherwise
throws `StorageOperationNotSupportedError`. It is a public URL, not a signed one.

### `./s3`

| Export                     | Kind  | Shape                                                            | Notes                                                                                                                           |
| -------------------------- | ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `S3StorageProviderOptions` | class | `new S3StorageProviderOptions({ bucket })`                       | —                                                                                                                               |
| `S3StorageProvider`        | class | `@Injectable() new S3StorageProvider(client: S3Client, options)` | Stream writes use `lib-storage`'s multipart `Upload`; buffer/string writes use `PutObject`. Signing via `s3-request-presigner`. |

### `./gcs`

| Export                      | Kind  | Shape                                                            | Notes |
| --------------------------- | ----- | ---------------------------------------------------------------- | ----- |
| `GcsStorageProviderOptions` | class | `new GcsStorageProviderOptions({ bucket })`                      | —     |
| `GcsStorageProvider`        | class | `@Injectable() new GcsStorageProvider(client: Storage, options)` | —     |

## Canonical usage

```typescript
import { StorageProvider, DiskStorageProvider, DiskStorageProviderOptions, StorageObjectNotFoundError } from '@maroonedsoftware/storage';
import { S3StorageProvider, S3StorageProviderOptions } from '@maroonedsoftware/storage/s3';
import { S3Client } from '@aws-sdk/client-s3';
import { Duration } from 'luxon';

// Composition root — one backend, chosen from config
if (config.storage.driver === 's3') {
  registry.register(S3Client).useValue(new S3Client({ region: config.storage.region }));
  registry.register(S3StorageProviderOptions).useValue(new S3StorageProviderOptions({ bucket: config.storage.bucket }));
  registry.register(StorageProvider).useClass(S3StorageProvider).asSingleton();
} else {
  registry.register(DiskStorageProviderOptions).useValue(new DiskStorageProviderOptions({ rootDir: config.storage.rootDir }));
  registry.register(StorageProvider).useClass(DiskStorageProvider).asSingleton();
}

// Use
await storage.write(`users/${userId}/avatar.png`, stream, { contentType: 'image/png' });

const url = await storage.getSignedUrl(key, { operation: 'read', expiresIn: Duration.fromObject({ minutes: 15 }) });

// Paginate — list returns ONE page
let cursor: string | undefined;
do {
  const page = await storage.list({ prefix: `users/${userId}/`, cursor, limit: 1000 });
  for (const object of page.objects) process(object);
  cursor = page.cursor;
} while (cursor);
```

## Rules for generated code

- Import cloud providers from `@maroonedsoftware/storage/s3` or `/gcs`, never from the root. The
  root barrel does not export them, and the split keeps the SDKs optional.
- Register and inject the abstract `StorageProvider`. Choosing the backend is a composition-root
  decision driven by config.
- Register the `*Options` classes as values in the container. They are classes specifically so they
  can be InjectKit tokens.
- **Always loop on `cursor`.** `list()` returns one page; treating it as complete silently truncates
  results for any prefix with more objects than the backend's page size.
- Stream large bodies. Pass a `Readable` rather than reading a file into a `Buffer` first — on S3
  that is also what selects multipart upload.
- Set `contentType` on write. Backends do not sniff it, and a wrong or missing type breaks browser
  rendering and signed-URL uploads.
- Use `exists()` for presence checks rather than catching `StorageObjectNotFoundError` from `stat()`.
- Prefer signed URLs over proxying bytes through your API for client uploads and downloads.
- Use Luxon `Duration` for `expiresIn` and expect a Luxon `DateTime` from `lastModified`.
- Sanitise keys built from user input. Keys are `/`-separated paths and the disk backend maps them
  onto the filesystem.

## Gotchas

- **`list()` is a single page, not an iterator.** The most common bug against this API is treating
  the first `StorageListResult` as the whole listing.
- **Range bounds are inclusive on both ends.** `{ start: 0, end: 1023 }` reads 1024 bytes, matching
  HTTP `Range` rather than JavaScript slice semantics.
- **The disk backend silently drops `metadata`.** The filesystem has no slot for it, so
  `StorageWriteOptions.metadata` is accepted and discarded, and `stat()` never returns it. Code
  that round-trips metadata works on S3/GCS and quietly loses data on disk.
- **`DiskStorageProvider.getSignedUrl` does not sign anything.** With `publicBaseUrl` set it returns
  `${publicBaseUrl}/${key}` — a permanent public URL that ignores `expiresIn` and `operation`.
  Without it, the call throws. Do not rely on disk signed URLs for access control.
- **`delete` is idempotent, `copy`/`move` are not forgiving.** Deleting a missing key succeeds;
  copying from a missing key throws.
- **`copy` and `move` are same-backend only.** Cross-bucket and cross-backend transfers are out of
  scope; read and re-write instead.
- **A missing optional peer fails at import time**, not at first use. Importing `/s3` without the
  AWS SDKs installed is a module-resolution error at startup.
- **`cursor` is opaque and backend-specific.** Do not persist one across a backend swap, and do not
  parse it.
- **Backends silently ignore write options they cannot honour** (`cacheControl` on disk, for
  example). There is no error and no warning.

## Working inside this package

```
src/
  index.ts                   Root barrel — abstraction + errors + disk backend
  storage.provider.ts        StorageProvider and every option/result type
  storage.errors.ts          StorageError and its three subclasses
  disk.storage.provider.ts   DiskStorageProvider, DiskStorageProviderOptions
  s3.ts                      Subpath entry for ./s3
  s3.storage.provider.ts     S3StorageProvider, S3StorageProviderOptions
  gcs.ts                     Subpath entry for ./gcs
  gcs.storage.provider.ts    GcsStorageProvider, GcsStorageProviderOptions
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import `@aws-sdk/*` or `@google-cloud/storage`.**
  That is the whole point of the `./s3` and `./gcs` entries; a stray import makes an optional peer
  mandatory for every consumer.
- The behaviour contract documented on `StorageProvider` (not-found throws, `exists` never throws,
  `delete` idempotent, `copy`/`move` overwrite the destination) must hold identically in all three
  backends. `tests/` should assert it uniformly.
- SDK errors get mapped to the typed `StorageError` subclasses at the backend boundary. A raw AWS
  or GCS error escaping to a caller is a bug — it breaks the abstraction.
- `*Options` types must stay classes so they remain InjectKit tokens.
- A new backend gets its own `src/<name>.ts` entry, an `exports` entry, a tsup entry in the `build`
  script, and its SDK under `peerDependenciesMeta` as optional.

User-visible changes need a changeset in `.changeset/`.
