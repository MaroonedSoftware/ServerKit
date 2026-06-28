import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Duration } from 'luxon';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { S3StorageProvider, S3StorageProviderOptions } from '../../src/s3.storage.provider.js';
import { StorageObjectNotFoundError } from '../../src/storage.errors.js';

// Opt-in: requires a running S3-compatible endpoint (LocalStack by default).
// See tests/integration/README.md for the one-line docker command.
const enabled = process.env.STORAGE_INTEGRATION === '1';
const endpoint = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:4566';
const bucket = process.env.S3_BUCKET ?? 'serverkit-storage-test';

async function collect(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe.skipIf(!enabled)('S3StorageProvider (integration)', () => {
  let client: S3Client;
  let provider: S3StorageProvider;
  // Unique per run so repeated runs against a persistent bucket never collide.
  const prefix = `it/${randomUUID()}/`;

  beforeAll(async () => {
    client = new S3Client({
      endpoint,
      region: process.env.AWS_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error) {
      // Tolerate a bucket that already exists from a previous run.
      const name = (error as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
        throw error;
      }
    }
    provider = new S3StorageProvider(client, new S3StorageProviderOptions({ bucket }));
  });

  afterAll(() => {
    client?.destroy();
  });

  it('round-trips a buffer write and reports metadata via stat', async () => {
    const key = `${prefix}note.txt`;
    await provider.write(key, 'hello world', { contentType: 'text/plain', metadata: { owner: 'alice' } });

    expect(await collect(await provider.read(key))).toBe('hello world');
    const meta = await provider.stat(key);
    expect(meta.size).toBe(11);
    expect(meta.contentType).toBe('text/plain');
    expect(meta.etag).toBeTruthy();
    expect(meta.lastModified?.isValid).toBe(true);
    expect(meta.metadata).toMatchObject({ owner: 'alice' });
  });

  it('streams a large body through the multipart Upload path', async () => {
    const key = `${prefix}big.bin`;
    // > 5 MiB forces lib-storage to switch to a real multipart upload.
    const payload = 'x'.repeat(6 * 1024 * 1024);
    await provider.write(key, Readable.from(payload));
    expect((await provider.stat(key)).size).toBe(payload.length);
  });

  it('reads an inclusive byte range', async () => {
    const key = `${prefix}range.txt`;
    await provider.write(key, '0123456789');
    expect(await collect(await provider.read(key, { range: { start: 2, end: 5 } }))).toBe('2345');
    expect(await collect(await provider.read(key, { range: { start: 7 } }))).toBe('789');
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

  it('lists by prefix and paginates via the continuation token', async () => {
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

  it('produces a presigned GET url that actually serves the object', async () => {
    const key = `${prefix}signed.txt`;
    await provider.write(key, 'signed-content');
    const url = await provider.getSignedUrl(key, { operation: 'read', expiresIn: Duration.fromObject({ minutes: 5 }) });

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('signed-content');
  });
});
