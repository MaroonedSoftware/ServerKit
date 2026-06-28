import { Injectable } from 'injectkit';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat as fsStat, unlink } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { DateTime } from 'luxon';
import mime from 'mime-types';
import { StorageAccessDeniedError, StorageObjectNotFoundError, StorageOperationNotSupportedError } from './storage.errors.js';
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
 * Construction options for {@link DiskStorageProvider}.
 *
 * A class (not an interface) so it can serve as an InjectKit token — register
 * an instance and the container can construct {@link DiskStorageProvider}.
 */
export class DiskStorageProviderOptions {
  /** Root directory the provider stores objects under. */
  readonly rootDir: string;
  /**
   * Base URL objects are publicly served from. When set, {@link DiskStorageProvider.getSignedUrl}
   * returns `${publicBaseUrl}/${key}`; when omitted, signing is unsupported.
   */
  readonly publicBaseUrl?: string;

  constructor(init: { rootDir: string; publicBaseUrl?: string }) {
    this.rootDir = init.rootDir;
    this.publicBaseUrl = init.publicBaseUrl;
  }
}

/**
 * {@link StorageProvider} backed by the local filesystem rooted at a directory.
 *
 * Keys map to paths under the root; nested keys create intermediate directories
 * on write. User metadata is not persisted (the filesystem has no native slot),
 * and `getSignedUrl` requires a configured `publicBaseUrl`. Useful for local
 * development and as an in-process test double.
 */
@Injectable()
export class DiskStorageProvider extends StorageProvider {
  constructor(private readonly options: DiskStorageProviderOptions) {
    super();
  }

  async write(key: string, body: Readable | Buffer | string, _options?: StorageWriteOptions): Promise<void> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    const source = body instanceof Readable ? body : Readable.from(body instanceof Buffer ? body : Buffer.from(body));
    await pipeline(source, createWriteStream(path));
  }

  async read(key: string, options?: StorageReadOptions): Promise<Readable> {
    const path = this.resolveKey(key);
    await this.assertExists(key, path);
    // `start`/`end` map directly to fs's inclusive byte offsets.
    return options?.range ? createReadStream(path, { start: options.range.start, end: options.range.end }) : createReadStream(path);
  }

  async stat(key: string): Promise<StorageObjectMetadata> {
    const path = this.resolveKey(key);
    const stats = await this.assertExists(key, path);
    const contentType = mime.lookup(path);
    return {
      key,
      size: stats.size,
      contentType: contentType === false ? undefined : contentType,
      lastModified: DateTime.fromJSDate(stats.mtime),
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      const stats = await fsStat(this.resolveKey(key));
      return stats.isFile();
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      if (isAccessDenied(error)) {
        throw new StorageAccessDeniedError(key, { cause: error });
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // `force: true` makes this idempotent — no error when the path is absent.
    await rm(this.resolveKey(key), { force: true });
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const source = this.resolveKey(sourceKey);
    const destination = this.resolveKey(destinationKey);
    await this.assertExists(sourceKey, source);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  async move(sourceKey: string, destinationKey: string): Promise<void> {
    const source = this.resolveKey(sourceKey);
    const destination = this.resolveKey(destinationKey);
    await this.assertExists(sourceKey, source);
    await mkdir(dirname(destination), { recursive: true });
    try {
      // Atomic and cheap on the same filesystem.
      await rename(source, destination);
    } catch (error) {
      // `rename` cannot cross filesystem boundaries — fall back to copy + delete.
      if (typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(source, destination);
        await unlink(source);
        return;
      }
      throw error;
    }
  }

  /**
   * Lists objects under the root, optionally filtered by prefix.
   *
   * Note: this walks the entire directory tree and `stat`s every matching file
   * on each call — pagination slices an in-memory list, it does not make paging
   * cheaper. Fine for development and modest trees (its intended use); avoid
   * pointing it at very large directories.
   */
  async list(options?: StorageListOptions): Promise<StorageListResult> {
    const prefix = options?.prefix ?? '';
    const keys: string[] = [];
    await this.walk(this.options.rootDir, keys);
    const matched = keys.filter(key => key.startsWith(prefix)).sort();

    // Cursor is the last key returned by the previous page; resume after it.
    const start = options?.cursor ? matched.findIndex(key => key > options.cursor!) : 0;
    const from = start === -1 ? matched.length : start;
    const limit = options?.limit ?? matched.length;
    const page = matched.slice(from, from + limit);

    const objects = await Promise.all(page.map(key => this.stat(key)));
    const hasMore = from + limit < matched.length;
    return {
      objects,
      cursor: hasMore && page.length > 0 ? page[page.length - 1] : undefined,
    };
  }

  async getSignedUrl(key: string, _options: SignedUrlOptions): Promise<string> {
    if (!this.options.publicBaseUrl) {
      throw new StorageOperationNotSupportedError('getSignedUrl');
    }
    // Normalise the key against the root for traversal safety, then join to the base URL.
    this.resolveKey(key);
    // Encode each path segment so keys with spaces or reserved characters yield a valid URL.
    const encodedPath = key
      .replace(/^\/+/, '')
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    return `${this.options.publicBaseUrl.replace(/\/+$/, '')}/${encodedPath}`;
  }

  /** Resolve a key to an absolute path, rejecting traversal that escapes the root. */
  private resolveKey(key: string): string {
    const path = resolve(this.options.rootDir, key);
    const rel = relative(this.options.rootDir, path);
    if (rel === '' || rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
      throw new StorageOperationNotSupportedError(`key '${key}' resolves outside the storage root`);
    }
    return path;
  }

  private async assertExists(key: string, path: string) {
    try {
      const stats = await fsStat(path);
      if (!stats.isFile()) {
        throw new StorageObjectNotFoundError(key);
      }
      return stats;
    } catch (error) {
      if (isNotFound(error)) {
        throw new StorageObjectNotFoundError(key, { cause: error });
      }
      if (isAccessDenied(error)) {
        throw new StorageAccessDeniedError(key, { cause: error });
      }
      throw error;
    }
  }

  /** Recursively collect file keys (root-relative, `/`-separated) under `dir`. */
  private async walk(dir: string, into: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, into);
      } else if (entry.isFile()) {
        into.push(relative(this.options.rootDir, full).split(sep).join(posix.sep));
      }
    }
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isAccessDenied(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EACCES' || code === 'EPERM';
}
