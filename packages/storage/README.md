# @maroonedsoftware/storage

Object storage abstraction for ServerKit. Provides a DI-friendly `StorageProvider` interface and ready-made backends for the local filesystem, AWS S3, and Google Cloud Storage.

## Installation

```bash
pnpm add @maroonedsoftware/storage
```

The cloud SDKs are **optional peer dependencies** — install only the one(s) you use. The disk backend needs nothing extra.

```bash
# AWS S3
pnpm add @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner

# Google Cloud Storage
pnpm add @google-cloud/storage
```

### Entry points

The cloud backends live behind subpath exports so importing the core never loads an SDK you didn't install:

| Import | Contents | Pulls in |
|--------|----------|----------|
| `@maroonedsoftware/storage` | `StorageProvider`, the errors, `DiskStorageProvider` | nothing extra |
| `@maroonedsoftware/storage/s3` | `S3StorageProvider`, `S3StorageProviderOptions` | `@aws-sdk/*` |
| `@maroonedsoftware/storage/gcs` | `GcsStorageProvider`, `GcsStorageProviderOptions` | `@google-cloud/storage` |

## Usage

### 1. Bind a provider in your DI container

Consumers depend only on the abstract `StorageProvider`; bind whichever backend fits the environment.

```typescript
import { StorageProvider, DiskStorageProvider, DiskStorageProviderOptions } from '@maroonedsoftware/storage';

// Local disk (great for development and tests)
container.bind(StorageProvider).toConstantValue(new DiskStorageProvider(new DiskStorageProviderOptions({ rootDir: '/var/data' })));
```

```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { StorageProvider } from '@maroonedsoftware/storage';
import { S3StorageProvider, S3StorageProviderOptions } from '@maroonedsoftware/storage/s3';

// AWS S3 — both the client and the options are injectable tokens
container.bind(S3Client).toConstantValue(new S3Client({ region: 'us-east-1' }));
container.bind(S3StorageProviderOptions).toConstantValue(new S3StorageProviderOptions({ bucket: 'my-bucket' }));
container.bind(StorageProvider).to(S3StorageProvider);
```

```typescript
import { Storage } from '@google-cloud/storage';
import { StorageProvider } from '@maroonedsoftware/storage';
import { GcsStorageProvider, GcsStorageProviderOptions } from '@maroonedsoftware/storage/gcs';

// Google Cloud Storage
container.bind(Storage).toConstantValue(new Storage());
container.bind(GcsStorageProviderOptions).toConstantValue(new GcsStorageProviderOptions({ bucket: 'my-bucket' }));
container.bind(StorageProvider).to(GcsStorageProvider);
```

### 2. Inject and use

```typescript
import { Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { StorageProvider } from '@maroonedsoftware/storage';

@Injectable()
class AvatarService {
  constructor(private readonly storage: StorageProvider) {}

  async save(userId: string, body: Buffer) {
    await this.storage.write(`users/${userId}/avatar.png`, body, { contentType: 'image/png' });
  }

  async thumbnail(userId: string) {
    // Partial read — first 1 KiB only
    return await this.storage.read(`users/${userId}/avatar.png`, { range: { start: 0, end: 1023 } });
  }

  async downloadUrl(userId: string) {
    // Time-limited URL for the client to fetch directly
    return await this.storage.getSignedUrl(`users/${userId}/avatar.png`, {
      operation: 'read',
      expiresIn: Duration.fromObject({ minutes: 15 }),
    });
  }
}
```

## API

### `StorageProvider` (abstract)

Base class to extend when implementing a custom backend. Keys are hierarchical, `/`-separated paths (e.g. `users/42/avatar.png`).

| Method | Signature | Description |
|--------|-----------|-------------|
| `write` | `(key, body: Readable \| Buffer \| string, options?: StorageWriteOptions) => Promise<void>` | Writes `key`, overwriting any existing object. |
| `read` | `(key, options?: StorageReadOptions) => Promise<Readable>` | Opens a stream, optionally for an inclusive byte range. Throws if absent. |
| `stat` | `(key) => Promise<StorageObjectMetadata>` | Fetches metadata without reading the body. Throws if absent. |
| `exists` | `(key) => Promise<boolean>` | `true` / `false` — never throws for absence. |
| `delete` | `(key) => Promise<void>` | Idempotent — deleting a missing key is a no-op. |
| `copy` | `(sourceKey, destinationKey) => Promise<void>` | Server-side copy within the backend. Throws if the source is missing. |
| `move` | `(sourceKey, destinationKey) => Promise<void>` | Move/rename within the backend. Throws if the source is missing. |
| `list` | `(options?: StorageListOptions) => Promise<StorageListResult>` | One page of objects, optionally filtered by `prefix`, with a `cursor` for the next page. |
| `getSignedUrl` | `(key, options: SignedUrlOptions) => Promise<string>` | Time-limited URL for direct client read/write. |

#### Behaviour contract

- `read` / `stat` on a missing key throw `StorageObjectNotFoundError`.
- A permission failure throws `StorageAccessDeniedError`.
- `delete` is idempotent; `copy` / `move` overwrite the destination and operate **within one backend** (same bucket/root) — cross-backend transfers are out of scope.
- `getSignedUrl` throws `StorageOperationNotSupportedError` on backends that can't sign.

### Errors

All extend `StorageError`, which extends `ServerkitError` (so `errorMiddleware` renders them):

- `StorageObjectNotFoundError` — missing object (carries `key`).
- `StorageAccessDeniedError` — permission failure (carries `key`).
- `StorageOperationNotSupportedError` — operation unsupported by the active backend.

## Backends

### `DiskStorageProvider`

Local filesystem rooted at a directory. Nested keys create intermediate directories on write; path traversal outside the root is rejected. User metadata is not persisted (the filesystem has no native slot). `getSignedUrl` requires a `publicBaseUrl`:

```typescript
new DiskStorageProvider(new DiskStorageProviderOptions({ rootDir: '/var/data', publicBaseUrl: 'https://cdn.example.com' }));
```

> `list` walks the whole tree and `stat`s each match per call — fine for development and modest trees, not for very large directories.

### `S3StorageProvider`

AWS S3 (or any S3-compatible endpoint). Streaming writes use `@aws-sdk/lib-storage`'s multipart `Upload`; buffer/string writes use a single `PutObject`. Signed URLs come from `@aws-sdk/s3-request-presigner`.

> `copy` (and therefore `move`) uses S3's single-request `CopyObject`, which is capped at 5 GB. Larger objects need a multipart copy, which this provider does not yet implement.

### `GcsStorageProvider`

Google Cloud Storage via `@google-cloud/storage`, including native `copy` / `move` and v4 signed URLs.

## Custom implementations

Extend `StorageProvider` to add your own backend (in-memory, Azure Blob, etc.) and honour the behaviour contract above:

```typescript
import { Injectable } from 'injectkit';
import { Readable } from 'node:stream';
import { StorageProvider, StorageObjectNotFoundError } from '@maroonedsoftware/storage';

@Injectable()
export class InMemoryStorageProvider extends StorageProvider {
  private readonly store = new Map<string, Buffer>();

  async write(key: string, body: Readable | Buffer | string) {
    this.store.set(key, body instanceof Readable ? Buffer.concat(await body.toArray()) : Buffer.from(body));
  }

  async read(key: string) {
    const data = this.store.get(key);
    if (!data) throw new StorageObjectNotFoundError(key);
    return Readable.from(data);
  }

  // ...stat, exists, delete, copy, move, list, getSignedUrl
}
```

## Configuration

The provider options are plain injectable classes, so the package stays decoupled from `@maroonedsoftware/appconfig`. To drive a bucket name from typed config, bridge it at bootstrap rather than importing AppConfig into the provider:

```typescript
import { S3StorageProviderOptions } from '@maroonedsoftware/storage/s3';

registry.register(S3StorageProviderOptions).useFactory(c => new S3StorageProviderOptions({ bucket: c.get(StorageOptions).value.bucket }));
```
