import { describe, expect, it } from 'vitest';
import { levelRank, matches, type ServerFeedEvent } from '../src/server.feed.event.js';

/** Build a ServerFeedEvent with sensible defaults for filter tests. */
function ev(overrides: Partial<ServerFeedEvent> = {}): ServerFeedEvent {
  return {
    id: 1,
    ts: '2026-07-24T00:00:00.000Z',
    source: 'render',
    level: 'info',
    kind: 'progress',
    ...overrides,
  };
}

describe('levelRank', () => {
  it('orders debug < info < warn < error', () => {
    expect(levelRank('debug')).toBeLessThan(levelRank('info'));
    expect(levelRank('info')).toBeLessThan(levelRank('warn'));
    expect(levelRank('warn')).toBeLessThan(levelRank('error'));
  });
});

describe('matches', () => {
  it('matches everything when no filter is given', () => {
    expect(matches(ev())).toBe(true);
    expect(matches(ev(), {})).toBe(true);
  });

  it('filters by a single source and by a source list', () => {
    expect(matches(ev({ source: 'llm' }), { source: 'llm' })).toBe(true);
    expect(matches(ev({ source: 'llm' }), { source: 'render' })).toBe(false);
    expect(matches(ev({ source: 'llm' }), { source: ['render', 'llm'] })).toBe(true);
    expect(matches(ev({ source: 'tts' }), { source: ['render', 'llm'] })).toBe(false);
  });

  it('filters by correlationId', () => {
    expect(matches(ev({ correlationId: 'deep-dive' }), { correlationId: 'deep-dive' })).toBe(true);
    expect(matches(ev({ correlationId: 'other' }), { correlationId: 'deep-dive' })).toBe(false);
    // An event without a correlationId cannot match a correlationId filter.
    expect(matches(ev(), { correlationId: 'deep-dive' })).toBe(false);
  });

  it('treats level as an inclusive minimum severity', () => {
    expect(matches(ev({ level: 'warn' }), { level: 'info' })).toBe(true);
    expect(matches(ev({ level: 'info' }), { level: 'info' })).toBe(true);
    expect(matches(ev({ level: 'debug' }), { level: 'info' })).toBe(false);
    expect(matches(ev({ level: 'error' }), { level: 'error' })).toBe(true);
  });

  it('filters by a single kind and by a kind list', () => {
    expect(matches(ev({ kind: 'progress' }), { kind: 'progress' })).toBe(true);
    expect(matches(ev({ kind: 'log' }), { kind: 'progress' })).toBe(false);
    expect(matches(ev({ kind: 'status' }), { kind: ['progress', 'status'] })).toBe(true);
    expect(matches(ev({ kind: 'heartbeat' }), { kind: ['progress', 'status'] })).toBe(false);
  });

  it('requires all present fields to match (AND semantics)', () => {
    const e = ev({ source: 'llm', correlationId: 'call-1', level: 'error', kind: 'error' });
    expect(matches(e, { source: 'llm', level: 'warn', kind: 'error' })).toBe(true);
    expect(matches(e, { source: 'llm', level: 'warn', kind: 'progress' })).toBe(false);
  });
});
