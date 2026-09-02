import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { openSseReply } from '../src/sse/sse.reply.js';
import { fakeRes } from './sse.response.fake.js';

describe('openSseReply', () => {
  it('hijacks the reply before writing the streaming headers to the raw response', () => {
    const res = fakeRes();
    const order: string[] = [];
    const original = res.writeHead.bind(res);
    res.writeHead = (status, headers) => {
      order.push('writeHead');
      original(status, headers);
    };
    const reply = { raw: res, hijack: vi.fn(() => order.push('hijack')) } as unknown as FastifyReply;

    const stream = openSseReply(reply, { heartbeatMs: 0 });
    stream.event({ data: 'hello' });
    stream.close();

    expect(order).toEqual(['hijack', 'writeHead']);
    expect(res.statusWritten).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('text/event-stream');
    expect(res.written).toEqual(['data: hello\n\n']);
    expect(res.ended).toBe(true);
  });

  it('forwards stream options', () => {
    const res = fakeRes();
    const reply = { raw: res, hijack: vi.fn() } as unknown as FastifyReply;
    const controller = new AbortController();

    const stream = openSseReply(reply, { heartbeatMs: 0, headers: { 'X-Custom': 'yes' }, signal: controller.signal });
    controller.abort();

    expect(res.headers?.['X-Custom']).toBe('yes');
    expect(stream.closed).toBe(true);
  });
});
