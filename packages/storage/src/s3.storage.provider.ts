import { Injectable } from 'injectkit';
import { Readable } from 'node:stream';
import { DateTime } from 'luxon';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
 * Construction options for {@link S3StorageProvider}.
 *
 * A class (not an interface) so it can serve as an InjectKit token — register
 * an instance and the container can construct {@link S3StorageProvider}.
 */
export class S3StorageProviderOptions {
  /** Name of the bucket all keys live in. */
  readonly bucket: string;

  constructor(init: { bucket: string }) {
    this.bucket = init.bucket;
  }
}

/**
 * {@link StorageProvider} backed by an AWS S3 (or S3-compatible) bucket.
 *
 * Streaming writes go through `@aws-sdk/lib-storage`'s multipart `Upload`;
 * buffer/string writes use a single `PutObject`. Signed URLs are produced with
 * `@aws-sdk/s3-request-presigner`.
 */
@Injectable()
export class S3StorageProvider extends StorageProvider {
  constructor(
    private readonly client: S3Client,
    private readonly options: S3StorageProviderOptions,
  ) {
    super();
  }

  async write(key: string, body: Readable | Buffer | string, options?: StorageWriteOptions): Promise<void> {
    const shared = {
      Bucket: this.options.bucket,
      Key: key,
      ContentType: options?.contentType,
      ContentLength: options?.contentLength,
      CacheControl: options?.cacheControl,
      Metadata: options?.metadata,
    };

    if (body instanceof Readable) {
      // lib-storage streams the body, automatically switching to multipart for large objects.
      const upload = new Upload({ client: this.client, params: { ...shared, Body: body } });
      await upload.done();
      return;
    }

    await this.client.send(new PutObjectCommand({ ...shared, Body: body }));
  }

  async read(key: string, options?: StorageReadOptions): Promise<Readable> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key, Range: toRangeHeader(options?.range) }),
      );
      return response.Body as Readable;
    } catch (error) {
      throw this.mapError(key, error);
    }
  }

  async stat(key: string): Promise<StorageObjectMetadata> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return {
        key,
        size: head.ContentLength ?? 0,
        contentType: head.ContentType,
        etag: head.ETag,
        lastModified: head.LastModified ? DateTime.fromJSDate(head.LastModified) : undefined,
        metadata: head.Metadata,
      };
    } catch (error) {
      throw this.mapError(key, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      // A 403 is a permission failure, not absence — surface it.
      throw this.mapError(key, error);
    }
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is idempotent — deleting a missing key succeeds.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  /**
   * Server-side copy via `CopyObjectCommand`.
   *
   * Note: S3's single-request `CopyObject` is capped at 5 GB. Copying a larger
   * object requires a multipart copy (`UploadPartCopy`), which this provider
   * does not yet implement — such copies will fail. {@link move} inherits the
   * same limit since it delegates to `copy`.
   */
  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.options.bucket,
          Key: destinationKey,
          // CopySource must be the URL-encoded `bucket/key` of the source object.
          CopySource: `${this.options.bucket}/${encodeURIComponent(sourceKey)}`,
        }),
      );
    } catch (error) {
      throw this.mapError(sourceKey, error);
    }
  }

  async move(sourceKey: string, destinationKey: string): Promise<void> {
    // S3 has no native move — copy then delete the source.
    await this.copy(sourceKey, destinationKey);
    await this.delete(sourceKey);
  }

  async list(options?: StorageListOptions): Promise<StorageListResult> {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.options.bucket,
        Prefix: options?.prefix,
        MaxKeys: options?.limit,
        ContinuationToken: options?.cursor,
      }),
    );

    const objects: StorageObjectMetadata[] = (response.Contents ?? []).map(item => ({
      key: item.Key ?? '',
      size: item.Size ?? 0,
      etag: item.ETag,
      lastModified: item.LastModified ? DateTime.fromJSDate(item.LastModified) : undefined,
    }));

    return {
      objects,
      cursor: response.IsTruncated ? response.NextContinuationToken : undefined,
    };
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const command =
      options.operation === 'write'
        ? new PutObjectCommand({ Bucket: this.options.bucket, Key: key, ContentType: options.contentType })
        : new GetObjectCommand({ Bucket: this.options.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: Math.round(options.expiresIn.as('seconds')) });
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

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined;
}

function statusCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode : undefined;
}

function isNotFound(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NoSuchKey' || name === 'NotFound' || statusCode(error) === 404;
}

function isAccessDenied(error: unknown): boolean {
  return errorName(error) === 'AccessDenied' || statusCode(error) === 403;
}

/** Build an HTTP `Range` header (`bytes=start-end`) from an inclusive byte range. */
function toRangeHeader(range?: { start: number; end?: number }): string | undefined {
  return range ? `bytes=${range.start}-${range.end ?? ''}` : undefined;
}
