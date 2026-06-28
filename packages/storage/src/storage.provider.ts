import { Injectable } from 'injectkit';
import { Readable } from 'node:stream';
import { DateTime, Duration } from 'luxon';

/**
 * Options applied when writing an object. All fields are optional; backends
 * that cannot honour a given field ignore it (documented per provider).
 */
export interface StorageWriteOptions {
  /** MIME type stored alongside the object (e.g. `image/png`). */
  contentType?: string;
  /** Byte length of the body, when known ahead of time. */
  contentLength?: number;
  /** `Cache-Control` header persisted with the object (cloud backends). */
  cacheControl?: string;
  /** Arbitrary user metadata. Unsupported on the disk backend (ignored). */
  metadata?: Record<string, string>;
}

/**
 * Options for {@link StorageProvider.read}.
 */
export interface StorageReadOptions {
  /**
   * Restrict the read to a byte range. `start` and `end` are both inclusive
   * (HTTP `Range` semantics); omit `end` to read from `start` to the end of the
   * object. Useful for media streaming and resumable downloads.
   */
  range?: { start: number; end?: number };
}

/**
 * Metadata describing a stored object, returned by {@link StorageProvider.stat}
 * and {@link StorageProvider.list}.
 */
export interface StorageObjectMetadata {
  /** The object's key. */
  key: string;
  /** Size in bytes. */
  size: number;
  /** MIME type, when known. */
  contentType?: string;
  /** Backend entity tag, when provided. */
  etag?: string;
  /** Last modification time, when known. */
  lastModified?: DateTime;
  /** User metadata, when the backend supports and returns it. */
  metadata?: Record<string, string>;
}

/**
 * Options for {@link StorageProvider.list}.
 */
export interface StorageListOptions {
  /** Restrict results to keys beginning with this prefix. */
  prefix?: string;
  /** Maximum number of objects to return in this page. */
  limit?: number;
  /** Opaque continuation token from a previous {@link StorageListResult}. */
  cursor?: string;
}

/**
 * A single page of {@link StorageProvider.list} results.
 */
export interface StorageListResult {
  /** Objects in this page. */
  objects: StorageObjectMetadata[];
  /** Continuation token for the next page, or `undefined` when exhausted. */
  cursor?: string;
}

/** Whether a signed URL grants read (download) or write (upload) access. */
export type SignedUrlOperation = 'read' | 'write';

/**
 * Options for {@link StorageProvider.getSignedUrl}.
 */
export interface SignedUrlOptions {
  /** The operation the URL authorises. */
  operation: SignedUrlOperation;
  /** How long the URL remains valid. */
  expiresIn: Duration;
  /** Content type the client must use when uploading (`write` URLs). */
  contentType?: string;
}

/**
 * Backend-agnostic object storage. Implementations wrap a concrete backend
 * (local disk, AWS S3, Google Cloud Storage). Bind a concrete provider to this
 * token in the DI container so consumers depend only on the abstraction:
 *
 * ```ts
 * container.bind(StorageProvider).toConstantValue(new DiskStorageProvider({ rootDir: '/var/data' }));
 * ```
 *
 * Keys are hierarchical, `/`-separated paths (e.g. `users/42/avatar.png`), not
 * flat filenames.
 *
 * ## Behaviour contract
 * - {@link read} / {@link stat} on a missing key throw `StorageObjectNotFoundError`.
 * - {@link exists} never throws for a missing key — it returns `false`.
 * - Operations that hit a permission failure throw `StorageAccessDeniedError`.
 * - {@link delete} is idempotent — deleting a missing key is a no-op.
 * - {@link copy} / {@link move} throw `StorageObjectNotFoundError` when the
 *   source is missing, and overwrite the destination if it already exists. Both
 *   operate within this backend only (same bucket / root) — cross-backend or
 *   cross-bucket transfers are out of scope.
 * - {@link getSignedUrl} throws `StorageOperationNotSupportedError` on backends
 *   that cannot sign URLs.
 */
@Injectable()
export abstract class StorageProvider {
  /** Write `body` to `key`, overwriting any existing object. */
  abstract write(key: string, body: Readable | Buffer | string, options?: StorageWriteOptions): Promise<void>;
  /** Open a readable stream for `key`, optionally for a byte range. Throws if the key does not exist. */
  abstract read(key: string, options?: StorageReadOptions): Promise<Readable>;
  /** Fetch metadata for `key` without reading its body. Throws if absent. */
  abstract stat(key: string): Promise<StorageObjectMetadata>;
  /** Resolve to `true` if `key` exists, `false` otherwise. Never throws for absence. */
  abstract exists(key: string): Promise<boolean>;
  /** Delete `key`. A no-op if the key does not exist. */
  abstract delete(key: string): Promise<void>;
  /** Copy `sourceKey` to `destinationKey` within this backend, overwriting the destination. Throws if the source is missing. */
  abstract copy(sourceKey: string, destinationKey: string): Promise<void>;
  /** Move/rename `sourceKey` to `destinationKey` within this backend, overwriting the destination. Throws if the source is missing. */
  abstract move(sourceKey: string, destinationKey: string): Promise<void>;
  /** List a single page of objects, optionally filtered by prefix. */
  abstract list(options?: StorageListOptions): Promise<StorageListResult>;
  /** Generate a time-limited signed URL for direct client read/write access. */
  abstract getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>;
}
