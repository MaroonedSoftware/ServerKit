import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Storage } from '@google-cloud/storage';
import { GcsStorageProvider, GcsStorageProviderOptions } from '../../src/gcs.storage.provider.js';
import { StorageObjectNotFoundError } from '../../src/storage.errors.js';

// Opt-in: requires a running GCS emulator (fake-gcs-server by default).
// See tests/integration/README.md for the one-line docker command.
//
// Note: signed URLs are intentionally not exercised here — fake-gcs-server has
// no service-account key, so v4 signing has nothing to sign with. That path is
// covered by the unit tests against the mocked SDK.
const enabled = process.env.STORAGE_INTEGRATION === '1';
const apiEndpoint = process.env.GCS_ENDPOINT ?? 'http://127.0.0.1:4443';
const bucket = process.env.GCS_BUCKET ?? 'serverkit-storage-test';

async function collect(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe.skipIf(!enabled)('GcsStorageProvider (integration)', () => {
  let storage: Storage;
  let provider: GcsStorageProvider;
  // Unique per run so repeated runs against a persistent bucket never collide.
  const prefix = `it/${randomUUID()}/`;

  beforeAll(async () => {
    storage = new Storage({ apiEndpoint, projectId: process.env.GCS_PROJECT_ID ?? 'test' });
    try {
      await storage.createBucket(bucket);
    } catch (error) {
      // Tolerate a bucket that already exists from a previous run.
      if ((error as { code?: number }).code !== 409) {
        throw error;
      }
    }
    provider = new GcsStorageProvider(storage, new GcsStorageProviderOptions({ bucket }));
  });

  afterAll(async () => {
    await storage?.close?.();
  });

  it('round-trips a buffer write and reports metadata via stat', async () => {
    const key = `${prefix}note.txt`;
    await provider.write(key, 'hello world', { contentType: 'text/plain', metadata: { owner: 'alice' } });

    expect(await collect(await provider.read(key))).toBe('hello world');
    const meta = await provider.stat(key);
    expect(meta.size).toBe(11);
    expect(meta.contentType).toBe('text/plain');
    expect(meta.lastModified?.isValid).toBe(true);
    expect(meta.metadata).toMatchObject({ owner: 'alice' });
  });

  it('round-trips a streamed write', async () => {
    const key = `${prefix}stream.txt`;
    await provider.write(key, Readable.from(['a', 'b', 'c']));
    expect(await collect(await provider.read(key))).toBe('abc');
  });

  it('reads an inclusive byte range', async () => {
    const key = `${prefix}range.txt`;
    await provider.write(key, '0123456789');
    expect(await collect(await provider.read(key, { range: { start: 2, end: 5 } }))).toBe('2345');
  });

  it('exists reflects writes and delete is idempotent', async () => {
    const key = `${prefix}temp.txt`;
    await provider.write(key, 'x');
    expect(await provider.exists(key)).toBe(true);
    await provider.delete(key);
    expect(await provider.exists(key)).toBe(false);
    await expect(provider.delete(key)).resolves.toBeUndefined();
  });

  it('read on a missing key throws StorageObjectNotFoundError', async () => {
    await expect(provider.read(`${prefix}missing.txt`)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('copies and moves within the bucket', async () => {
    const src = `${prefix}src.txt`;
    await provider.write(src, 'payload');

    await provider.copy(src, `${prefix}copy.txt`);
    expect(await collect(await provider.read(`${prefix}copy.txt`))).toBe('payload');
    expect(await provider.exists(src)).toBe(true);

    await provider.move(src, `${prefix}moved.txt`);
    expect(await provider.exists(src)).toBe(false);
    expect(await collect(await provider.read(`${prefix}moved.txt`))).toBe('payload');
  });

  it('lists by prefix and paginates via the page token', async () => {
    const base = `${prefix}list/`;
    await provider.write(`${base}a.txt`, '1');
    await provider.write(`${base}b.txt`, '2');

    const first = await provider.list({ prefix: base, limit: 1 });
    expect(first.objects).toHaveLength(1);
    expect(first.cursor).toBeDefined();

    const second = await provider.list({ prefix: base, limit: 1, cursor: first.cursor });
    expect(second.objects).toHaveLength(1);

    const keys = [...first.objects, ...second.objects].map(o => o.key).sort();
    expect(keys).toEqual([`${base}a.txt`, `${base}b.txt`]);
  });
});
