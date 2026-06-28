import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { Duration } from 'luxon';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { S3StorageProvider, S3StorageProviderOptions } from '../src/s3.storage.provider.js';
import { StorageAccessDeniedError, StorageObjectNotFoundError } from '../src/storage.errors.js';

const { uploadDone } = vi.hoisted(() => ({ uploadDone: vi.fn() }));
vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn(function () {
    return { done: uploadDone };
  }),
}));

const signedUrl = vi.fn();
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => signedUrl(...args),
}));

const send = vi.fn();
const client = { send } as unknown as S3Client;

let provider: S3StorageProvider;

beforeEach(() => {
  provider = new S3StorageProvider(client, new S3StorageProviderOptions({ bucket: 'my-bucket' }));
});

afterEach(() => {
  vi.clearAllMocks();
});

function notFound(name = 'NotFound') {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
}

function accessDenied() {
  return Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
}

describe('write', () => {
  it('uses PutObjectCommand with mapped options for a Buffer body', async () => {
    send.mockResolvedValue({});
    await provider.write('k.txt', Buffer.from('data'), { contentType: 'text/plain', cacheControl: 'max-age=60', metadata: { a: '1' } });

    const command = send.mock.calls[0]![0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'my-bucket',
      Key: 'k.txt',
      ContentType: 'text/plain',
      CacheControl: 'max-age=60',
      Metadata: { a: '1' },
    });
  });

  it('uses lib-storage Upload for a Readable body', async () => {
    uploadDone.mockResolvedValue({});
    const { Upload } = await import('@aws-sdk/lib-storage');
    await provider.write('stream.bin', Readable.from(['x']));

    expect(Upload).toHaveBeenCalledTimes(1);
    expect(uploadDone).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('read', () => {
  it('returns the response body as a Readable', async () => {
    const body = Readable.from(['hi']);
    send.mockResolvedValue({ Body: body });
    expect(await provider.read('k.txt')).toBe(body);
    expect(send.mock.calls[0]![0]).toBeInstanceOf(GetObjectCommand);
  });

  it('maps a 404 to StorageObjectNotFoundError', async () => {
    send.mockRejectedValue(notFound('NoSuchKey'));
    await expect(provider.read('missing')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('maps a 403 to StorageAccessDeniedError', async () => {
    send.mockRejectedValue(accessDenied());
    await expect(provider.read('forbidden')).rejects.toBeInstanceOf(StorageAccessDeniedError);
  });

  it('passes an inclusive byte range as a Range header', async () => {
    send.mockResolvedValue({ Body: Readable.from(['x']) });
    await provider.read('k.txt', { range: { start: 2, end: 5 } });
    expect((send.mock.calls[0]![0] as GetObjectCommand).input).toMatchObject({ Range: 'bytes=2-5' });
  });

  it('builds an open-ended Range header when no end is given', async () => {
    send.mockResolvedValue({ Body: Readable.from(['x']) });
    await provider.read('k.txt', { range: { start: 7 } });
    expect((send.mock.calls[0]![0] as GetObjectCommand).input).toMatchObject({ Range: 'bytes=7-' });
  });
});

describe('stat', () => {
  it('maps HeadObject output to metadata', async () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    send.mockResolvedValue({ ContentLength: 12, ContentType: 'image/png', ETag: '"abc"', LastModified: date, Metadata: { k: 'v' } });

    const meta = await provider.stat('photo.png');
    expect(send.mock.calls[0]![0]).toBeInstanceOf(HeadObjectCommand);
    expect(meta).toMatchObject({ key: 'photo.png', size: 12, contentType: 'image/png', etag: '"abc"', metadata: { k: 'v' } });
    expect(meta.lastModified?.toUTC().toISO()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('maps a 404 to StorageObjectNotFoundError', async () => {
    send.mockRejectedValue(notFound());
    await expect(provider.stat('missing')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});

describe('exists', () => {
  it('returns true on success', async () => {
    send.mockResolvedValue({});
    expect(await provider.exists('k')).toBe(true);
  });

  it('returns false on 404', async () => {
    send.mockRejectedValue(notFound());
    expect(await provider.exists('k')).toBe(false);
  });

  it('throws StorageAccessDeniedError on 403', async () => {
    send.mockRejectedValue(accessDenied());
    await expect(provider.exists('k')).rejects.toBeInstanceOf(StorageAccessDeniedError);
  });

  it('rethrows other errors untouched', async () => {
    send.mockRejectedValue(Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } }));
    await expect(provider.exists('k')).rejects.toThrow('boom');
  });
});

describe('delete', () => {
  it('sends DeleteObjectCommand', async () => {
    send.mockResolvedValue({});
    await provider.delete('k');
    const command = send.mock.calls[0]![0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'my-bucket', Key: 'k' });
  });
});

describe('copy', () => {
  it('sends CopyObjectCommand with a URL-encoded CopySource', async () => {
    send.mockResolvedValue({});
    await provider.copy('a/src file.txt', 'b/dest.txt');
    const command = send.mock.calls[0]![0] as CopyObjectCommand;
    expect(command).toBeInstanceOf(CopyObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'my-bucket',
      Key: 'b/dest.txt',
      CopySource: `my-bucket/${encodeURIComponent('a/src file.txt')}`,
    });
  });

  it('maps a 404 to StorageObjectNotFoundError', async () => {
    send.mockRejectedValue(notFound('NoSuchKey'));
    await expect(provider.copy('missing', 'dest')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});

describe('move', () => {
  it('copies then deletes the source', async () => {
    send.mockResolvedValue({});
    await provider.move('src', 'dest');
    expect(send.mock.calls[0]![0]).toBeInstanceOf(CopyObjectCommand);
    const del = send.mock.calls[1]![0] as DeleteObjectCommand;
    expect(del).toBeInstanceOf(DeleteObjectCommand);
    expect(del.input).toMatchObject({ Bucket: 'my-bucket', Key: 'src' });
  });

  it('does not delete the source when the copy fails', async () => {
    send.mockRejectedValueOnce(notFound('NoSuchKey'));
    await expect(provider.move('missing', 'dest')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('list', () => {
  it('maps contents and propagates the continuation token', async () => {
    send.mockResolvedValue({
      Contents: [{ Key: 'a', Size: 1, ETag: '"1"', LastModified: new Date('2026-01-01T00:00:00.000Z') }],
      IsTruncated: true,
      NextContinuationToken: 'next-token',
    });

    const result = await provider.list({ prefix: 'a', limit: 10, cursor: 'prev' });
    const command = send.mock.calls[0]![0] as ListObjectsV2Command;
    expect(command.input).toMatchObject({ Bucket: 'my-bucket', Prefix: 'a', MaxKeys: 10, ContinuationToken: 'prev' });
    expect(result.objects).toEqual([{ key: 'a', size: 1, etag: '"1"', lastModified: expect.anything() }]);
    expect(result.cursor).toBe('next-token');
  });

  it('returns undefined cursor when not truncated', async () => {
    send.mockResolvedValue({ Contents: [], IsTruncated: false });
    const result = await provider.list();
    expect(result.cursor).toBeUndefined();
  });
});

describe('getSignedUrl', () => {
  it('signs a GetObjectCommand for read with expiry in seconds', async () => {
    signedUrl.mockResolvedValue('https://signed/read');
    const url = await provider.getSignedUrl('k', { operation: 'read', expiresIn: Duration.fromObject({ minutes: 5 }) });
    expect(url).toBe('https://signed/read');
    expect(signedUrl.mock.calls[0]![1]).toBeInstanceOf(GetObjectCommand);
    expect(signedUrl.mock.calls[0]![2]).toEqual({ expiresIn: 300 });
  });

  it('signs a PutObjectCommand for write', async () => {
    signedUrl.mockResolvedValue('https://signed/write');
    await provider.getSignedUrl('k', { operation: 'write', expiresIn: Duration.fromObject({ seconds: 60 }), contentType: 'text/plain' });
    const command = signedUrl.mock.calls[0]![1] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'my-bucket', Key: 'k', ContentType: 'text/plain' });
  });
});
