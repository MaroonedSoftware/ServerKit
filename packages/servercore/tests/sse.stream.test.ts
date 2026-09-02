import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSseStream, type SseResponse } from '../src/sse/sse.stream.js';
import { fakeRes, fakeSseCtx } from './sse.response.fake.js';

describe('openSseStream', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes over the socket and writes the streaming headers', () => {
    const res = fakeRes();
    const ctx = fakeSseCtx(res);

    openSseStream(ctx, { heartbeatMs: 0 });

    expect(ctx.status).toBe(200);
    expect(ctx.respond).toBe(false);
    expect(res.timeoutSet).toBe(0);
    expect(res.statusWritten).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('text/event-stream');
    expect(res.headers?.['Cache-Control']).toBe('no-cache, no-transform');
    expect(res.headers?.['X-Accel-Buffering']).toBe('no');
  });

  it('merges extra headers over the defaults', () => {
    const res = fakeRes();
    openSseStream(fakeSseCtx(res), { heartbeatMs: 0, headers: { 'Cache-Control': 'no-store', 'X-Feed': 'jobs' } });

    expect(res.headers?.['Cache-Control']).toBe('no-store');
    expect(res.headers?.['X-Feed']).toBe('jobs');
    expect(res.headers?.['Content-Type']).toBe('text/event-stream');
  });

  it('writes frames, comments, and raw chunks', () => {
    const res = fakeRes();
    const stream = openSseStream(fakeSseCtx(res), { heartbeatMs: 0 });

    stream.event({ id: 1, data: { a: 1 } });
    stream.comment('hello');
    stream.write('raw\n\n');

    expect(res.written).toEqual(['id: 1\ndata: {"a":1}\n\n', ': hello\n\n', 'raw\n\n']);
  });

  it('emits heartbeat comments on the interval and stops once closed', () => {
    const res = fakeRes();
    const stream = openSseStream(fakeSseCtx(res), { heartbeatMs: 1000 });

    vi.advanceTimersByTime(2500);
    expect(res.written.filter(c => c === ': ping\n\n')).toHaveLength(2);

    stream.close();
    vi.advanceTimersByTime(5000);
    expect(res.written.filter(c => c === ': ping\n\n')).toHaveLength(2);
  });

  it('runs close listeners once and ends the socket', () => {
    const res = fakeRes();
    const stream = openSseStream(fakeSseCtx(res), { heartbeatMs: 0 });
    const cleanup = vi.fn();
    stream.onClose(cleanup);

    stream.close();
    stream.close(); // idempotent

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(res.ended).toBe(true);
    expect(stream.closed).toBe(true);
  });

  it('runs a listener immediately when registered after close', () => {
    const res = fakeRes();
    const stream = openSseStream(fakeSseCtx(res), { heartbeatMs: 0 });
    stream.close();

    const cleanup = vi.fn();
    stream.onClose(cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps tearing down when one close listener throws', () => {
    const res = fakeRes();
    const stream = openSseStream(fakeSseCtx(res), { heartbeatMs: 0 });
    const second = vi.fn();
    stream.onClose(() => {
      throw new Error('boom');
    });
    stream.onClose(second);

    stream.close();
    expect(second).toHaveBeenCalledTimes(1);
    expect(res.ended).toBe(true);
  });

  it('ends on socket close and destroys on socket error', () => {
    const closed = fakeRes();
    openSseStream(fakeSseCtx(closed), { heartbeatMs: 0 });
    closed.emit('close');
    expect(closed.ended).toBe(true);
    expect(closed.destroyed).toBe(false);

    const errored = fakeRes();
    openSseStream(fakeSseCtx(errored), { heartbeatMs: 0 });
    errored.emit('error');
    expect(errored.destroyed).toBe(true);
  });

  it('drops writes once closed', () => {
    const res = fakeRes();
    const stream = openSseStream(fakeSseCtx(res), { heartbeatMs: 0 });
    stream.close();

    stream.event({ data: 'ignored' });
    expect(res.written).toHaveLength(0);
  });

  it('closes the stream when the lifecycle signal aborts', () => {
    const res = fakeRes();
    const controller = new AbortController();
    const stream = openSseStream(fakeSseCtx(res), { heartbeatMs: 1000, signal: controller.signal });
    const cleanup = vi.fn();
    stream.onClose(cleanup);

    controller.abort();

    expect(stream.closed).toBe(true);
    expect(res.ended).toBe(true);
    expect(res.destroyed).toBe(false); // a drain, not a client that misbehaved
    expect(cleanup).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(res.written.filter(c => c === ': ping\n\n')).toHaveLength(0);
  });

  it('closes immediately when opened with an already-aborted signal', () => {
    const res = fakeRes();
    const stream = openSseStream(fakeSseCtx(res), { heartbeatMs: 1000, signal: AbortSignal.abort() });

    expect(stream.closed).toBe(true);
    expect(res.ended).toBe(true);

    // No heartbeat may outlive the stream: nothing would ever clear it.
    vi.advanceTimersByTime(5000);
    expect(res.written).toHaveLength(0);
  });

  it('drops its abort listener on close so the long-lived signal does not leak streams', () => {
    const res = fakeRes();
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const stream = openSseStream(fakeSseCtx(res), { heartbeatMs: 0, signal: controller.signal });

    stream.close();

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));

    // Aborting afterwards must not run teardown a second time.
    const cleanup = vi.fn();
    stream.onClose(cleanup); // runs immediately (already closed)
    controller.abort();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('destroys a client only once its buffer exceeds the backpressure ceiling', () => {
    const res = fakeRes();
    const stream = openSseStream(fakeSseCtx(res), { heartbeatMs: 0, maxBufferedBytes: 1_000_000 });

    // Backpressure but still within the ceiling → tolerated, the socket drains on its own.
    res.blocked = true;
    res.writableLength = 100;
    stream.event({ data: 'slow' });
    expect(res.destroyed).toBe(false);

    // Past the ceiling → dropped, so the client reconnects and resumes.
    res.writableLength = 2_000_000;
    stream.event({ data: 'flood' });
    expect(res.destroyed).toBe(true);
    expect(stream.closed).toBe(true);
  });
});

describe('openSseStream socket takeover seam', () => {
  it('calls the hijack hook once, before the headers are written', () => {
    const res = fakeRes();
    const order: string[] = [];
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = (status, headers) => {
      order.push('writeHead');
      originalWriteHead(status, headers);
    };
    const hijack = () => order.push('hijack');

    const stream = openSseStream({ res: res as unknown as SseResponse, hijack }, { heartbeatMs: 0 });
    stream.close();

    expect(order).toEqual(['hijack', 'writeHead']);
  });

  it('works without any Koa fields on the context', () => {
    const res = fakeRes();

    const stream = openSseStream({ res: res as unknown as SseResponse }, { heartbeatMs: 0 });
    stream.event({ data: 'x' });
    stream.close();

    expect(res.statusWritten).toBe(200);
    expect(res.written).toEqual(['data: x\n\n']);
  });
});
