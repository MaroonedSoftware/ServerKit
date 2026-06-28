import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Duration } from 'luxon';
import { DiskStorageProvider, DiskStorageProviderOptions } from '../src/disk.storage.provider.js';
import { StorageAccessDeniedError, StorageObjectNotFoundError, StorageOperationNotSupportedError } from '../src/storage.errors.js';

const isRoot = process.getuid?.() === 0;

async function collect(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

let root: string;
let provider: DiskStorageProvider;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'serverkit-storage-'));
  provider = new DiskStorageProvider(new DiskStorageProviderOptions({ rootDir: root }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('write / read', () => {
  it('round-trips a string body, creating nested directories', async () => {
    await provider.write('users/42/note.txt', 'hello world');
    const stream = await provider.read('users/42/note.txt');
    expect(await collect(stream)).toBe('hello world');
  });

  it('round-trips a Buffer body', async () => {
    await provider.write('blob.bin', Buffer.from('binary'));
    expect(await collect(await provider.read('blob.bin'))).toBe('binary');
  });

  it('round-trips a Readable body', async () => {
    await provider.write('stream.txt', Readable.from(['a', 'b', 'c']));
    expect(await collect(await provider.read('stream.txt'))).toBe('abc');
  });

  it('overwrites an existing object', async () => {
    await provider.write('k.txt', 'first');
    await provider.write('k.txt', 'second');
    expect(await collect(await provider.read('k.txt'))).toBe('second');
  });

  it('read throws StorageObjectNotFoundError for a missing key', async () => {
    await expect(provider.read('missing.txt')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('reads an inclusive byte range', async () => {
    await provider.write('range.txt', '0123456789');
    expect(await collect(await provider.read('range.txt', { range: { start: 2, end: 5 } }))).toBe('2345');
  });

  it('reads from an offset to the end when no range end is given', async () => {
    await provider.write('range.txt', '0123456789');
    expect(await collect(await provider.read('range.txt', { range: { start: 7 } }))).toBe('789');
  });
});

describe('stat', () => {
  it('returns size, inferred content type, and last-modified', async () => {
    await provider.write('photo.png', 'pngdata');
    const meta = await provider.stat('photo.png');
    expect(meta.key).toBe('photo.png');
    expect(meta.size).toBe(7);
    expect(meta.contentType).toBe('image/png');
    expect(meta.lastModified?.isValid).toBe(true);
  });

  it('throws StorageObjectNotFoundError for a missing key', async () => {
    await expect(provider.stat('nope')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});

describe('exists', () => {
  it('returns true for an existing object and false otherwise', async () => {
    await provider.write('here.txt', 'x');
    expect(await provider.exists('here.txt')).toBe(true);
    expect(await provider.exists('gone.txt')).toBe(false);
  });
});

describe('delete', () => {
  it('removes an existing object', async () => {
    await provider.write('temp.txt', 'x');
    await provider.delete('temp.txt');
    expect(await provider.exists('temp.txt')).toBe(false);
  });

  it('is idempotent for a missing key', async () => {
    await expect(provider.delete('never.txt')).resolves.toBeUndefined();
  });
});

describe('copy', () => {
  it('copies an object, leaving the source in place', async () => {
    await provider.write('a/src.txt', 'payload');
    await provider.copy('a/src.txt', 'b/dest.txt');
    expect(await collect(await provider.read('b/dest.txt'))).toBe('payload');
    expect(await provider.exists('a/src.txt')).toBe(true);
  });

  it('throws StorageObjectNotFoundError when the source is missing', async () => {
    await expect(provider.copy('missing.txt', 'dest.txt')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});

describe('move', () => {
  it('moves an object, removing the source', async () => {
    await provider.write('a/src.txt', 'payload');
    await provider.move('a/src.txt', 'b/dest.txt');
    expect(await collect(await provider.read('b/dest.txt'))).toBe('payload');
    expect(await provider.exists('a/src.txt')).toBe(false);
  });

  it('throws StorageObjectNotFoundError when the source is missing', async () => {
    await expect(provider.move('missing.txt', 'dest.txt')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});

describe('list', () => {
  beforeEach(async () => {
    await provider.write('a/1.txt', '1');
    await provider.write('a/2.txt', '2');
    await provider.write('b/3.txt', '3');
  });

  it('lists all objects with normalised keys', async () => {
    const result = await provider.list();
    expect(result.objects.map(o => o.key).sort()).toEqual(['a/1.txt', 'a/2.txt', 'b/3.txt']);
  });

  it('filters by prefix', async () => {
    const result = await provider.list({ prefix: 'a/' });
    expect(result.objects.map(o => o.key).sort()).toEqual(['a/1.txt', 'a/2.txt']);
    expect(result.cursor).toBeUndefined();
  });

  it('paginates via the cursor', async () => {
    const first = await provider.list({ limit: 2 });
    expect(first.objects.map(o => o.key)).toEqual(['a/1.txt', 'a/2.txt']);
    expect(first.cursor).toBe('a/2.txt');

    const second = await provider.list({ limit: 2, cursor: first.cursor });
    expect(second.objects.map(o => o.key)).toEqual(['b/3.txt']);
    expect(second.cursor).toBeUndefined();
  });
});

describe('getSignedUrl', () => {
  it('throws when no public base URL is configured', async () => {
    await expect(provider.getSignedUrl('k.txt', { operation: 'read', expiresIn: Duration.fromObject({ minutes: 5 }) })).rejects.toBeInstanceOf(
      StorageOperationNotSupportedError,
    );
  });

  it('returns a joined public URL when configured', async () => {
    const served = new DiskStorageProvider(new DiskStorageProviderOptions({ rootDir: root, publicBaseUrl: 'https://cdn.example.com/' }));
    const url = await served.getSignedUrl('users/42/a.png', { operation: 'read', expiresIn: Duration.fromObject({ minutes: 5 }) });
    expect(url).toBe('https://cdn.example.com/users/42/a.png');
  });

  it('URL-encodes path segments with reserved characters', async () => {
    const served = new DiskStorageProvider(new DiskStorageProviderOptions({ rootDir: root, publicBaseUrl: 'https://cdn.example.com' }));
    const url = await served.getSignedUrl('users/a b & c.png', { operation: 'read', expiresIn: Duration.fromObject({ minutes: 5 }) });
    expect(url).toBe('https://cdn.example.com/users/a%20b%20%26%20c.png');
  });
});

describe('access denied', () => {
  // Removing search permission on a parent directory makes `stat` fail with
  // EACCES — the case the provider maps. (A mode-000 file still `stat`s fine;
  // that permission error only surfaces later on the read stream.)
  it.skipIf(isRoot)('maps EACCES to StorageAccessDeniedError', async () => {
    await provider.write('locked/secret.txt', 'secret');
    await chmod(join(root, 'locked'), 0o000);
    try {
      await expect(provider.read('locked/secret.txt')).rejects.toBeInstanceOf(StorageAccessDeniedError);
      await expect(provider.stat('locked/secret.txt')).rejects.toBeInstanceOf(StorageAccessDeniedError);
    } finally {
      await chmod(join(root, 'locked'), 0o755);
    }
  });
});

describe('path safety', () => {
  it('rejects keys that traverse outside the root', async () => {
    await expect(provider.write('../escape.txt', 'x')).rejects.toBeInstanceOf(StorageOperationNotSupportedError);
    await expect(provider.read('../../etc/passwd')).rejects.toBeInstanceOf(StorageOperationNotSupportedError);
  });
});
