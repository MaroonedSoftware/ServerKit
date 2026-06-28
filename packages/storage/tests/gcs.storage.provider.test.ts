import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { Duration } from 'luxon';
import type { Storage } from '@google-cloud/storage';
import { GcsStorageProvider, GcsStorageProviderOptions } from '../src/gcs.storage.provider.js';
import { StorageAccessDeniedError, StorageObjectNotFoundError } from '../src/storage.errors.js';

const file = {
  save: vi.fn(),
  createWriteStream: vi.fn(),
  createReadStream: vi.fn(),
  getMetadata: vi.fn(),
  exists: vi.fn(),
  delete: vi.fn(),
  copy: vi.fn(),
  move: vi.fn(),
  getSignedUrl: vi.fn(),
  name: 'k',
};

const getFiles = vi.fn();
const fileFactory = vi.fn(() => file);
const bucket = vi.fn(() => ({ file: fileFactory, getFiles }));
const storage = { bucket } as unknown as Storage;

let provider: GcsStorageProvider;

beforeEach(() => {
  provider = new GcsStorageProvider(storage, new GcsStorageProviderOptions({ bucket: 'my-bucket' }));
});

afterEach(() => {
  vi.clearAllMocks();
});

function notFound() {
  return Object.assign(new Error('Not Found'), { code: 404 });
}

function accessDenied() {
  return Object.assign(new Error('Forbidden'), { code: 403 });
}

describe('write', () => {
  it('saves a Buffer/string body with mapped metadata', async () => {
    file.save.mockResolvedValue(undefined);
    await provider.write('k.txt', 'data', { contentType: 'text/plain', cacheControl: 'max-age=60', metadata: { a: '1' } });

    expect(bucket).toHaveBeenCalledWith('my-bucket');
    expect(fileFactory).toHaveBeenCalledWith('k.txt');
    expect(file.save).toHaveBeenCalledWith(Buffer.from('data'), {
      metadata: { contentType: 'text/plain', cacheControl: 'max-age=60', metadata: { a: '1' } },
    });
  });

  it('pipes a Readable body through a write stream', async () => {
    // A write stream that drains the source and finishes.
    const sink = new (await import('node:stream')).Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    file.createWriteStream.mockReturnValue(sink);
    await provider.write('stream.bin', Readable.from(['x']));
    expect(file.createWriteStream).toHaveBeenCalledTimes(1);
    expect(file.save).not.toHaveBeenCalled();
  });
});

describe('read', () => {
  it('returns a read stream when the object exists', async () => {
    file.exists.mockResolvedValue([true]);
    const stream = Readable.from(['hi']);
    file.createReadStream.mockReturnValue(stream);
    expect(await provider.read('k.txt')).toBe(stream);
  });

  it('throws StorageObjectNotFoundError when absent', async () => {
    file.exists.mockResolvedValue([false]);
    await expect(provider.read('missing')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('passes an inclusive byte range to createReadStream', async () => {
    file.exists.mockResolvedValue([true]);
    file.createReadStream.mockReturnValue(Readable.from(['x']));
    await provider.read('k.txt', { range: { start: 2, end: 5 } });
    expect(file.createReadStream).toHaveBeenCalledWith({ start: 2, end: 5 });
  });

  it('maps a 403 to StorageAccessDeniedError', async () => {
    file.exists.mockRejectedValue(accessDenied());
    await expect(provider.read('forbidden')).rejects.toBeInstanceOf(StorageAccessDeniedError);
  });
});

describe('stat', () => {
  it('maps metadata, coercing string size and ISO timestamps', async () => {
    file.getMetadata.mockResolvedValue([
      { size: '20', contentType: 'image/png', etag: 'abc', updated: '2026-01-02T03:04:05.000Z', metadata: { k: 'v' } },
    ]);

    const meta = await provider.stat('photo.png');
    expect(meta).toMatchObject({ key: 'photo.png', size: 20, contentType: 'image/png', etag: 'abc', metadata: { k: 'v' } });
    expect(meta.lastModified?.toUTC().toISO()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('maps a 404 to StorageObjectNotFoundError', async () => {
    file.getMetadata.mockRejectedValue(notFound());
    await expect(provider.stat('missing')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});

describe('exists', () => {
  it('unwraps the [boolean] tuple', async () => {
    file.exists.mockResolvedValue([true]);
    expect(await provider.exists('k')).toBe(true);
    file.exists.mockResolvedValue([false]);
    expect(await provider.exists('k')).toBe(false);
  });
});

describe('delete', () => {
  it('deletes with ignoreNotFound for idempotency', async () => {
    file.delete.mockResolvedValue(undefined);
    await provider.delete('k');
    expect(file.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});

describe('copy', () => {
  it('copies the source file to the destination file', async () => {
    file.copy.mockResolvedValue(undefined);
    await provider.copy('src', 'dest');
    expect(fileFactory).toHaveBeenNthCalledWith(1, 'src');
    expect(fileFactory).toHaveBeenNthCalledWith(2, 'dest');
    expect(file.copy).toHaveBeenCalledWith(file);
  });

  it('maps a 404 to StorageObjectNotFoundError', async () => {
    file.copy.mockRejectedValue(notFound());
    await expect(provider.copy('missing', 'dest')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});

describe('move', () => {
  it('moves the source file to the destination file', async () => {
    file.move.mockResolvedValue(undefined);
    await provider.move('src', 'dest');
    expect(file.move).toHaveBeenCalledWith(file);
  });

  it('maps a 404 to StorageObjectNotFoundError', async () => {
    file.move.mockRejectedValue(notFound());
    await expect(provider.move('missing', 'dest')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});

describe('list', () => {
  it('maps files and propagates the page token', async () => {
    getFiles.mockResolvedValue([
      [{ name: 'a', metadata: { size: '1', contentType: 'text/plain', etag: 'e', updated: '2026-01-01T00:00:00.000Z' } }],
      { pageToken: 'next' },
    ]);

    const result = await provider.list({ prefix: 'a', limit: 5, cursor: 'prev' });
    expect(getFiles).toHaveBeenCalledWith({ prefix: 'a', maxResults: 5, pageToken: 'prev', autoPaginate: false });
    expect(result.objects[0]).toMatchObject({ key: 'a', size: 1, contentType: 'text/plain', etag: 'e' });
    expect(result.cursor).toBe('next');
  });

  it('returns undefined cursor when there is no next query', async () => {
    getFiles.mockResolvedValue([[], null]);
    const result = await provider.list();
    expect(result.cursor).toBeUndefined();
  });
});

describe('getSignedUrl', () => {
  it('requests a v4 read URL', async () => {
    file.getSignedUrl.mockResolvedValue(['https://signed/read']);
    const url = await provider.getSignedUrl('k', { operation: 'read', expiresIn: Duration.fromObject({ minutes: 5 }) });
    expect(url).toBe('https://signed/read');
    expect(file.getSignedUrl.mock.calls[0]![0]).toMatchObject({ version: 'v4', action: 'read' });
  });

  it('requests a write URL with content type', async () => {
    file.getSignedUrl.mockResolvedValue(['https://signed/write']);
    await provider.getSignedUrl('k', { operation: 'write', expiresIn: Duration.fromObject({ seconds: 30 }), contentType: 'text/plain' });
    expect(file.getSignedUrl.mock.calls[0]![0]).toMatchObject({ action: 'write', contentType: 'text/plain' });
  });
});
