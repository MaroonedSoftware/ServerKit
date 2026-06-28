import { Injectable } from 'injectkit';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DateTime } from 'luxon';
import { Storage } from '@google-cloud/storage';
import type { File } from '@google-cloud/storage';
import { StorageAccessDeniedError, StorageObjectNotFoundError } from './storage.errors.js';
import type {
  SignedUrlOptions,
  StorageListOptions,
  StorageListResult,
  StorageObjectMetadata,
  StorageReadOptions,
  StorageWriteOptions,
} from './storage.provider.js';
import { StorageProvider } from './storage.provider.js';

/**
 * Construction options for {@link GcsStorageProvider}.
 *
 * A class (not an interface) so it can serve as an InjectKit token — register
 * an instance and the container can construct {@link GcsStorageProvider}.
 */
export class GcsStorageProviderOptions {
  /** Name of the bucket all keys live in. */
  readonly bucket: string;

  constructor(init: { bucket: string }) {
    this.bucket = init.bucket;
  }
}

/**
 * {@link StorageProvider} backed by a Google Cloud Storage bucket.
 */
@Injectable()
export class GcsStorageProvider extends StorageProvider {
  constructor(
    private readonly client: Storage,
    private readonly options: GcsStorageProviderOptions,
  ) {
    super();
  }

  async write(key: string, body: Readable | Buffer | string, options?: StorageWriteOptions): Promise<void> {
    const file = this.file(key);
    const metadata = {
      contentType: options?.contentType,
      cacheControl: options?.cacheControl,
      metadata: options?.metadata,
    };

    if (body instanceof Readable) {
      await pipeline(body, file.createWriteStream({ metadata }));
      return;
    }

    await file.save(body instanceof Buffer ? body : Buffer.from(body), { metadata });
  }

  async read(key: string, options?: StorageReadOptions): Promise<Readable> {
    // GCS surfaces a missing object on the stream's 'error' event rather than as
    // a rejected promise, so pre-check existence to honour the not-found contract.
    const exists = await this.exists(key);
    if (!exists) {
      throw new StorageObjectNotFoundError(key);
    }
    // `start`/`end` are inclusive byte offsets, matching the read contract.
    return this.file(key).createReadStream(options?.range ? { start: options.range.start, end: options.range.end } : undefined);
  }

  async stat(key: string): Promise<StorageObjectMetadata> {
    try {
      const [metadata] = await this.file(key).getMetadata();
      return {
        key,
        size: typeof metadata.size === 'string' ? Number(metadata.size) : (metadata.size ?? 0),
        contentType: metadata.contentType,
        etag: metadata.etag,
        lastModified: metadata.updated ? DateTime.fromISO(metadata.updated) : undefined,
        metadata: metadata.metadata as Record<string, string> | undefined,
      };
    } catch (error) {
      throw this.mapError(key, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const [exists] = await this.file(key).exists();
      return exists;
    } catch (error) {
      // `exists()` reports absence as `false`; a thrown error is a real failure
      // (e.g. a permission denial) and should surface.
      throw this.mapError(key, error);
    }
  }

  async delete(key: string): Promise<void> {
    await this.file(key).delete({ ignoreNotFound: true });
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      await this.file(sourceKey).copy(this.file(destinationKey));
    } catch (error) {
      throw this.mapError(sourceKey, error);
    }
  }

  async move(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      // GCS `move` is a server-side copy followed by a delete of the source.
      await this.file(sourceKey).move(this.file(destinationKey));
    } catch (error) {
      throw this.mapError(sourceKey, error);
    }
  }

  async list(options?: StorageListOptions): Promise<StorageListResult> {
    const [files, nextQuery] = await this.client.bucket(this.options.bucket).getFiles({
      prefix: options?.prefix,
      maxResults: options?.limit,
      pageToken: options?.cursor,
      autoPaginate: false,
    });

    const objects: StorageObjectMetadata[] = files.map(file => ({
      key: file.name,
      size: typeof file.metadata.size === 'string' ? Number(file.metadata.size) : (file.metadata.size ?? 0),
      contentType: file.metadata.contentType,
      etag: file.metadata.etag,
      lastModified: file.metadata.updated ? DateTime.fromISO(file.metadata.updated) : undefined,
    }));

    return {
      objects,
      cursor: (nextQuery as { pageToken?: string } | undefined)?.pageToken,
    };
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const [url] = await this.file(key).getSignedUrl({
      version: 'v4',
      action: options.operation === 'write' ? 'write' : 'read',
      expires: DateTime.now().plus(options.expiresIn).toMillis(),
      contentType: options.operation === 'write' ? options.contentType : undefined,
    });
    return url;
  }

  private file(key: string): File {
    return this.client.bucket(this.options.bucket).file(key);
  }

  private mapError(key: string, error: unknown): unknown {
    if (isNotFound(error)) {
      return new StorageObjectNotFoundError(key, { cause: error });
    }
    if (isAccessDenied(error)) {
      return new StorageAccessDeniedError(key, { cause: error });
    }
    return error;
  }
}

function statusCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null ? (error as { code?: number }).code : undefined;
}

function isNotFound(error: unknown): boolean {
  return statusCode(error) === 404;
}

function isAccessDenied(error: unknown): boolean {
  return statusCode(error) === 403;
}
