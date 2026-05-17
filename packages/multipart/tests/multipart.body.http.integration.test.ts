import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { MultipartBody } from '../src/multipart.body.js';
import { MultipartData } from '../src/types.js';

/**
 * Integration tests against a real http.Server. The mocked unit tests cannot reproduce
 * the close/finish race on IncomingMessage that caused parse() to hang in 1.1.2 — only
 * a live socket exhibits it.
 */
describe('MultipartBody (real HTTP)', () => {
  let server: Server;
  let baseUrl: string;
  let handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

  beforeEach(async () => {
    server = createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch(err => {
        if (!res.headersSent) res.writeHead(500);
        res.end(String(err));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { address, port } = server.address() as AddressInfo;
    baseUrl = `http://${address}:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const buildForm = (filename: string, payload: Buffer | string) => {
    const form = new FormData();
    form.append('description', 'hello');
    form.append('file', new Blob([payload]), filename);
    return form;
  };

  it('resolves promptly for a small upload with an async for-await file handler', async () => {
    let resolvedFields: Map<string, MultipartData | MultipartData[]> | undefined;

    handler = async (req, res) => {
      const body = new MultipartBody(req, { files: 1, fileSize: 1024 * 1024 });
      resolvedFields = await body.parse(async (_field, stream) => {
        for await (const _chunk of stream) {
          // drain — exact pattern that hung in 1.1.2
        }
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };

    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      body: buildForm('tiny.txt', 'hello world'),
      signal: AbortSignal.timeout(1000),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resolvedFields).toBeDefined();
    expect(resolvedFields!.get('description')).toMatchObject({ value: 'hello' });
    expect(resolvedFields!.get('file')).toMatchObject({ filename: 'tiny.txt' });
  });

  it('resolves for a payload larger than the default highWaterMark (~64 KB)', async () => {
    const big = Buffer.alloc(200 * 1024, 0x61); // 200 KB of 'a'
    let bytesSeen = 0;

    handler = async (req, res) => {
      const body = new MultipartBody(req, { files: 1, fileSize: 1024 * 1024 });
      await body.parse(async (_field, stream) => {
        for await (const chunk of stream) {
          bytesSeen += chunk.length;
        }
      });
      res.writeHead(200);
      res.end('ok');
    };

    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      body: buildForm('big.bin', big),
      signal: AbortSignal.timeout(2000),
    });

    expect(res.status).toBe(200);
    expect(bytesSeen).toBe(big.length);
  });

  it('rejects with a 413 HttpError when a single file exceeds the per-file fileSize limit', async () => {
    let parseError: unknown;

    handler = async (req, res) => {
      try {
        const body = new MultipartBody(req, { files: 1, fileSize: 1024 }); // 1 KB cap
        await body.parse(async (_field, stream) => {
          for await (const _chunk of stream) {
            // drain
          }
        });
        res.writeHead(200);
        res.end('ok');
      } catch (err) {
        parseError = err;
        if (!res.headersSent) res.writeHead(413);
        res.end();
      }
    };

    const big = Buffer.alloc(8 * 1024, 0x42); // 8 KB > 1 KB cap
    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      body: buildForm('toobig.bin', big),
      signal: AbortSignal.timeout(2000),
    });

    expect(res.status).toBe(413);
    const err = parseError as { statusCode?: number; internalDetails?: { reason?: string; filename?: string } };
    expect(err.statusCode).toBe(413);
    expect(err.internalDetails?.reason).toBe('Reached file size limit');
    expect(err.internalDetails?.filename).toBe('toobig.bin');
  });

  it('rejects with a 400 HttpError when the client aborts before the body completes', async () => {
    let parseError: unknown;
    const firstChunkReceived = new Promise<void>(resolve => {
      handler = async (req, res) => {
        req.once('data', () => resolve());
        try {
          const body = new MultipartBody(req, { files: 1, fileSize: 10 * 1024 * 1024 });
          await body.parse(async (_field, stream) => {
            for await (const _chunk of stream) {
              // keep draining
            }
          });
          res.writeHead(200);
          res.end('ok');
        } catch (err) {
          parseError = err;
          if (!res.headersSent) res.writeHead(499);
          res.end();
        }
      };
    });

    const controller = new AbortController();

    // Stream a body that emits one chunk, then never completes — gives the server
    // time to start parsing before we abort.
    const slowBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        const boundary = '----abortTest';
        const head =
          `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="never.bin"\r\n' +
          'Content-Type: application/octet-stream\r\n\r\n';
        controller.enqueue(new TextEncoder().encode(head));
        controller.enqueue(new Uint8Array(1024).fill(0x41)); // 'A' * 1024
        // intentionally never close — the client will abort
      },
    });

    const fetchPromise = fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----abortTest' },
      body: slowBody,
      signal: controller.signal,
      // @ts-expect-error Node fetch requires duplex for streamed bodies
      duplex: 'half',
    });

    await firstChunkReceived;
    controller.abort();

    await expect(fetchPromise).rejects.toThrow();

    // Give the server a tick to finish rejecting and writing the response.
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(parseError).toBeDefined();
    const err = parseError as { statusCode?: number; internalDetails?: { reason?: string } };
    expect(err.statusCode).toBe(400);
    expect(err.internalDetails?.reason).toBe('client aborted upload before body completed');
  });
});
