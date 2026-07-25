import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { ServerFeed } from '../src/server.feed.js';
import type { ServerFeedEvent } from '../src/server.feed.event.js';

/** The ISO string the bus produces for a given epoch-ms instant (UTC). */
const isoAt = (ms: number): string => DateTime.fromMillis(ms, { zone: 'utc' }).toISO()!;

describe('ServerFeed.publish', () => {
  it('assigns monotonic ids and an ISO timestamp from the injected clock', () => {
    let t = 1_700_000_000_000;
    const bus = new ServerFeed({ now: () => t });
    const a = bus.status('render', 'x', 'one');
    t += 1000;
    const b = bus.status('render', 'x', 'two');
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(a.ts).toBe(isoAt(1_700_000_000_000));
    expect(b.ts).toBe(isoAt(1_700_000_001_000));
  });

  it('honors a caller-supplied ts', () => {
    const bus = new ServerFeed();
    const e = bus.publish({ source: 'render', level: 'info', kind: 'status', ts: '2020-01-01T00:00:00.000Z' });
    expect(e.ts).toBe('2020-01-01T00:00:00.000Z');
  });

  it('derives progress level and error details from helpers', () => {
    const bus = new ServerFeed();
    expect(bus.progress('render', 'x', { phase: 'writing', index: 1, total: 3, status: 'running' }).level).toBe('info');
    expect(bus.progress('render', 'x', { phase: 'writing', index: 3, total: 3, status: 'failed' }).level).toBe('error');
    const err = bus.reportError('llm', new Error('boom'), 'call-1');
    expect(err).toMatchObject({ level: 'error', kind: 'error', message: 'boom', correlationId: 'call-1' });
    expect(err.data?.stack).toContain('boom');
  });
});

describe('ServerFeed replay + ring buffer', () => {
  it('replays only events newer than lastId, filtered', () => {
    const bus = new ServerFeed();
    bus.status('render', 'a', 'r1');
    bus.status('llm', 'b', 'l1');
    bus.status('render', 'a', 'r2');
    const { events, gap } = bus.replaySince(1, { source: 'render' });
    expect(gap).toBe(false);
    expect(events.map(e => e.id)).toEqual([3]);
  });

  it('evicts oldest past capacity and flags a gap for a stale resume point', () => {
    const bus = new ServerFeed({ bufferSize: 3 });
    for (let i = 0; i < 5; i++) bus.status('render', 'a', `m${i}`); // ids 1..5, retains 3..5
    const stale = bus.replaySince(1);
    expect(stale.gap).toBe(true);
    expect(stale.events.map(e => e.id)).toEqual([3, 4, 5]);

    // A resume point aligned to the buffer floor is not a gap.
    const aligned = bus.replaySince(2);
    expect(aligned.gap).toBe(false);
    expect(aligned.events.map(e => e.id)).toEqual([3, 4, 5]);
  });

  it('never flags a gap for a fresh client (lastId 0)', () => {
    const bus = new ServerFeed({ bufferSize: 2 });
    for (let i = 0; i < 5; i++) bus.status('render', 'a', `m${i}`);
    expect(bus.replaySince(0).gap).toBe(false);
  });
});

describe('ServerFeed.onEvent', () => {
  it('delivers matching live events and stops after unsubscribe', () => {
    const bus = new ServerFeed();
    const seen: ServerFeedEvent[] = [];
    const off = bus.onEvent({ source: 'llm' }, e => seen.push(e));
    bus.status('render', 'a', 'ignored');
    bus.status('llm', 'b', 'kept');
    off();
    bus.status('llm', 'b', 'after-unsub');
    expect(seen.map(e => e.message)).toEqual(['kept']);
  });

  it('keeps delivering to other listeners when one throws', () => {
    const bus = new ServerFeed();
    const good = vi.fn();
    bus.onEvent({}, () => {
      throw new Error('bad listener');
    });
    bus.onEvent({}, good);
    expect(() => bus.status('render', 'a', 'hi')).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });
});

describe('ServerFeed.snapshot', () => {
  it('keeps the latest progress/status/error per key, ignoring logs and heartbeats', () => {
    const bus = new ServerFeed();
    bus.status('render', 'a', 'first');
    bus.status('render', 'a', 'second');
    bus.log('info', 'log', 'a log line');
    bus.heartbeat('llm', 'call-1');
    const snap = bus.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ source: 'render', correlationId: 'a', message: 'second' });
  });

  it('evicts the oldest key past the snapshot cap', () => {
    const bus = new ServerFeed({ snapshotCap: 2 });
    bus.status('render', 'a', '1');
    bus.status('render', 'b', '2');
    bus.status('render', 'c', '3'); // evicts key render:a
    const keys = bus.snapshot().map(e => e.correlationId);
    expect(keys).toEqual(['b', 'c']);
  });

  it('refreshes recency on update so a touched key is not evicted first', () => {
    const bus = new ServerFeed({ snapshotCap: 2 });
    bus.status('render', 'a', '1');
    bus.status('render', 'b', '2');
    bus.status('render', 'a', '1b'); // touch a → b is now oldest
    bus.status('render', 'c', '3'); // evicts b
    const keys = bus
      .snapshot()
      .map(e => e.correlationId)
      .sort();
    expect(keys).toEqual(['a', 'c']);
  });
});
