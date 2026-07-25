import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerFeed } from '../src/server.feed.js';
import type { ServerFeedEvent } from '../src/server.feed.event.js';
import { Logger } from '@maroonedsoftware/logger';
import { ServerFeedLogger } from '../src/server.feed.logger.js';

/** A Logger test double recording every delegated call. */
function fakeInner(): Logger & { calls: Array<[string, unknown, unknown[]]> } {
  const calls: Array<[string, unknown, unknown[]]> = [];
  const record =
    (level: string) =>
    (message: unknown, ...params: unknown[]) => {
      calls.push([level, message, params]);
    };
  return {
    calls,
    error: record('error'),
    warn: record('warn'),
    info: record('info'),
    debug: record('debug'),
    trace: record('trace'),
  } as unknown as Logger & { calls: Array<[string, unknown, unknown[]]> };
}

describe('ServerFeedLogger', () => {
  let inner: ReturnType<typeof fakeInner>;
  let feed: ServerFeed;
  let events: ServerFeedEvent[];

  beforeEach(() => {
    inner = fakeInner();
    feed = new ServerFeed();
    events = [];
    feed.onEvent({}, e => events.push(e));
  });

  it('delegates every call to the inner logger', () => {
    const logger = new ServerFeedLogger(inner, feed);
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    logger.trace('t');
    expect(inner.calls.map(c => c[0])).toEqual(['error', 'warn', 'info', 'debug', 'trace']);
  });

  it('mirrors only warn+error to the bus by default', () => {
    const logger = new ServerFeedLogger(inner, feed);
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.trace('t');
    expect(events.map(e => ({ level: e.level, kind: e.kind, source: e.source, message: e.message }))).toEqual([
      { level: 'warn', kind: 'log', source: 'log', message: 'w' },
      { level: 'error', kind: 'log', source: 'log', message: 'e' },
    ]);
  });

  it('honors a custom minimum bus level', () => {
    const logger = new ServerFeedLogger(inner, feed, 'info');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    expect(events.map(e => e.message)).toEqual(['i', 'w']);
  });

  it('never mirrors trace even at the lowest bus level', () => {
    const logger = new ServerFeedLogger(inner, feed, 'debug');
    logger.trace('t');
    expect(events).toHaveLength(0);
    expect(inner.calls).toEqual([['trace', 't', []]]);
  });

  it('flattens an Error message and carries extra params as data', () => {
    const logger = new ServerFeedLogger(inner, feed);
    logger.error(new Error('boom'), { userId: 7 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ message: 'boom', data: { params: [{ userId: 7 }] } });
  });

  it('omits data when there are no extra params', () => {
    const logger = new ServerFeedLogger(inner, feed);
    logger.warn('plain');
    expect(events[0]?.data).toBeUndefined();
  });
});
