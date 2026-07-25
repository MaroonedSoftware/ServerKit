import { describe, it, expect } from 'vitest';
import { ServerFeed } from '@maroonedsoftware/serverfeed';
import { handleServerFeed, serverFeedFilterFromQuery, serverFeedRouter, type ServerFeedContext } from '../src/serverfeed/server.feed.stream.js';
import { fakeRes, fakeSseCtx, type FakeRes } from './sse.response.fake.js';

function fakeCtx(res: FakeRes, query: Record<string, unknown> = {}, lastEventIdHeader = ''): ServerFeedContext {
  return { ...fakeSseCtx(res), query, get: () => lastEventIdHeader };
}

describe('serverFeedFilterFromQuery', () => {
  it('parses comma lists for source and kind, dropping unknown kinds', () => {
    const filter = serverFeedFilterFromQuery({ source: 'render, llm', kind: 'progress,bogus,status', correlationId: 'x', level: 'warn' });
    expect(filter).toEqual({ source: ['render', 'llm'], kind: ['progress', 'status'], correlationId: 'x', level: 'warn' });
  });

  it('ignores an invalid level and takes the first value of an array field', () => {
    const filter = serverFeedFilterFromQuery({ source: ['render', 'llm'], level: 'nope' });
    expect(filter).toEqual({ source: ['render'] });
  });

  it('returns an empty filter for an empty query', () => {
    expect(serverFeedFilterFromQuery({})).toEqual({});
  });
});

describe('handleServerFeed', () => {
  it('replays the backlog then streams live events, honoring the filter', () => {
    const bus = new ServerFeed();
    bus.status('render', 'a', 'r1');
    const res = fakeRes();

    handleServerFeed(fakeCtx(res, { source: 'render' }), bus, { heartbeatMs: 0 });

    expect(res.headers?.['Content-Type']).toBe('text/event-stream');
    expect(res.written.some(c => c.includes('"message":"r1"'))).toBe(true);

    bus.status('render', 'a', 'r2');
    bus.status('llm', 'b', 'l1');
    expect(res.written.some(c => c.includes('"message":"r2"'))).toBe(true);
    expect(res.written.some(c => c.includes('"message":"l1"'))).toBe(false);
  });

  it('frames bus events under the feed event name, with the id as the resume key', () => {
    const bus = new ServerFeed();
    const res = fakeRes();
    handleServerFeed(fakeCtx(res), bus, { heartbeatMs: 0 });

    const event = bus.status('render', 'a', 'hi');
    expect(res.written[0]?.startsWith(`id: ${event.id}\nevent: server.feed\ndata: {`)).toBe(true);
  });

  it('resumes from Last-Event-ID and emits a resync event past the buffer floor', () => {
    const bus = new ServerFeed({ bufferSize: 3 });
    for (let i = 1; i <= 5; i++) bus.status('render', 'a', `m${i}`); // retains ids 3..5
    const res = fakeRes();

    handleServerFeed(fakeCtx(res, {}, '1'), bus, { heartbeatMs: 0 });

    expect(res.written[0]).toBe('event: resync\ndata: {}\n\n');
    expect(res.written.slice(1).map(c => c.match(/"id":(\d+)/)?.[1])).toEqual(['3', '4', '5']);
  });

  it('falls back to the lastEventId query value when the header is absent', () => {
    const bus = new ServerFeed();
    for (let i = 1; i <= 3; i++) bus.status('render', 'a', `m${i}`);
    const res = fakeRes();

    handleServerFeed(fakeCtx(res, { lastEventId: '2' }), bus, { heartbeatMs: 0 });

    expect(res.written.map(c => c.match(/"id":(\d+)/)?.[1])).toEqual(['3']);
  });

  it('unsubscribes from the bus when the socket closes', () => {
    const bus = new ServerFeed();
    const res = fakeRes();
    handleServerFeed(fakeCtx(res), bus, { heartbeatMs: 0 });

    res.emit('close');
    expect(res.ended).toBe(true);

    const before = res.written.length;
    bus.status('render', 'a', 'after-close');
    expect(res.written.length).toBe(before);
  });

  it('unsubscribes when backpressure closes the stream during the replay', () => {
    const bus = new ServerFeed();
    bus.status('render', 'a', 'backlog');
    const res = fakeRes();
    res.blocked = true;
    res.writableLength = 2_000_000;

    handleServerFeed(fakeCtx(res), bus, { heartbeatMs: 0, maxBufferedBytes: 1_000_000 });
    expect(res.destroyed).toBe(true);

    const before = res.written.length;
    bus.status('render', 'a', 'after-drop');
    expect(res.written.length).toBe(before);
  });
});

describe('serverFeedRouter', () => {
  it('mounts the SSE route at the default path', () => {
    const router = serverFeedRouter();
    const paths = (router as unknown as { stack: Array<{ path: string }> }).stack.map(l => l.path);
    expect(paths).toContain('/server/feed');
  });

  it('honors a custom path', () => {
    const router = serverFeedRouter({ path: '/ops/events' });
    const paths = (router as unknown as { stack: Array<{ path: string }> }).stack.map(l => l.path);
    expect(paths).toContain('/ops/events');
  });
});
