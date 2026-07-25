import { DateTime } from 'luxon';
import {
  matches,
  type ServerFeedEvent,
  type ServerFeedEventInput,
  type ServerFeedFilter,
  type ServerFeedLevel,
  type ServerFeedProgress,
} from './server.feed.event.js';

/** A live subscription: a filter plus the listener to invoke on matching events. */
interface Subscription {
  filter: ServerFeedFilter;
  listener: (event: ServerFeedEvent) => void;
}

/** Construction options for {@link ServerFeed}. */
export interface ServerFeedOptions {
  /** Max events retained for replay/catch-up (ring buffer). Default 1000. */
  bufferSize?: number;
  /** Max latest-per-key snapshot entries. Default 500. */
  snapshotCap?: number;
  /** Epoch-ms clock, injectable for tests. Defaults to the current time. */
  now?: () => number;
}

const DEFAULT_BUFFER = 1000;
const DEFAULT_SNAPSHOT_CAP = 500;

/**
 * An in-process publish/subscribe bus for realtime server activity: progress,
 * status/feedback, errors, and mirrored logs. Producers publish structured
 * {@link ServerFeedEvent}s; subscribers (an SSE transport, tests) receive the live
 * events matching a filter. A bounded ring buffer lets a late or reconnecting
 * subscriber replay what it missed (by Last-Event-ID), and a latest-per-key
 * snapshot renders current state without replaying the whole buffer.
 *
 * Framework-agnostic by design (no DI, HTTP, DB, or logger deps) so an app supplies
 * its own thin adapters. Fan-out runs each listener inside a try/catch so one that
 * throws can't break delivery to the others.
 */
export class ServerFeed {
  private seq = 0;
  private readonly bufferSize: number;
  private readonly snapshotCap: number;
  private readonly clock: () => number;
  private readonly ring: ServerFeedEvent[] = [];
  private readonly listeners = new Set<Subscription>();
  /** Latest progress/status/error per `${source}:${correlationId}`, insertion-ordered by recency. */
  private readonly snapshots = new Map<string, ServerFeedEvent>();

  constructor(options: ServerFeedOptions = {}) {
    this.bufferSize = Math.max(1, options.bufferSize ?? DEFAULT_BUFFER);
    this.snapshotCap = Math.max(1, options.snapshotCap ?? DEFAULT_SNAPSHOT_CAP);
    this.clock = options.now ?? (() => DateTime.now().toMillis());
  }

  /** Publish an event. The bus assigns a monotonic `id` and (unless given) `ts`. */
  publish(input: ServerFeedEventInput): ServerFeedEvent {
    const event: ServerFeedEvent = {
      ...input,
      id: ++this.seq,
      ts: input.ts ?? DateTime.fromMillis(this.clock(), { zone: 'utc' }).toISO() ?? '',
    };
    this.buffer(event);
    this.updateSnapshot(event);
    this.fanOut(event);
    return event;
  }

  // ── ergonomic helpers (thin wrappers over publish) ──────────────────────────

  /** Report step progress. Publishes at `error` level when the step failed, else `info`. */
  progress(source: string, correlationId: string, progress: ServerFeedProgress, message?: string): ServerFeedEvent {
    const level: ServerFeedLevel = progress.status === 'failed' ? 'error' : 'info';
    return this.publish({ source, correlationId, level, kind: 'progress', progress, message });
  }

  /** Report a status/feedback message for a correlated operation. */
  status(source: string, correlationId: string, message: string, data?: Record<string, unknown>): ServerFeedEvent {
    return this.publish({ source, correlationId, level: 'info', kind: 'status', message, data });
  }

  /** Mirror a log line onto the bus (used by the logger bridge). */
  log(level: ServerFeedLevel, source: string, message: string, data?: Record<string, unknown>): ServerFeedEvent {
    return this.publish({ source, level, kind: 'log', message, data });
  }

  /** Report an error, flattening an `Error` to its message (+ stack in `data`). */
  reportError(source: string, err: unknown, correlationId?: string): ServerFeedEvent {
    const message = err instanceof Error ? err.message : String(err);
    const data = err instanceof Error && err.stack ? { stack: err.stack } : undefined;
    return this.publish({ source, correlationId, level: 'error', kind: 'error', message, data });
  }

  /** Emit a liveness ping for an in-flight operation (kept out of the snapshot map). */
  heartbeat(source: string, correlationId?: string, data?: Record<string, unknown>): ServerFeedEvent {
    return this.publish({ source, correlationId, level: 'debug', kind: 'heartbeat', data });
  }

  // ── subscribe ───────────────────────────────────────────────────────────────

  /** Subscribe to matching live events. Returns an unsubscribe function. */
  onEvent(filter: ServerFeedFilter, listener: (event: ServerFeedEvent) => void): () => void {
    const sub: Subscription = { filter, listener };
    this.listeners.add(sub);
    return () => {
      this.listeners.delete(sub);
    };
  }

  // ── replay / snapshot ─────────────────────────────────────────────────────────

  /**
   * Buffered events newer than `lastId` that match `filter`. `gap` is true when
   * `lastId` points before the oldest retained event — the caller missed events
   * that have already been evicted and should re-seed from {@link snapshot}. A
   * fresh client (`lastId <= 0`) is not resuming, so it never reports a gap.
   */
  replaySince(lastId: number, filter?: ServerFeedFilter): { events: ServerFeedEvent[]; gap: boolean } {
    const floor = this.ring.length > 0 ? this.ring[0]!.id : this.seq + 1;
    const gap = lastId > 0 && lastId < floor - 1;
    const events = this.ring.filter(e => e.id > lastId && matches(e, filter));
    return { events, gap };
  }

  /** Latest progress/status/error event per correlation key, matching `filter`. */
  snapshot(filter?: ServerFeedFilter): ServerFeedEvent[] {
    const out: ServerFeedEvent[] = [];
    for (const e of this.snapshots.values()) if (matches(e, filter)) out.push(e);
    return out;
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  private buffer(event: ServerFeedEvent): void {
    this.ring.push(event);
    if (this.ring.length > this.bufferSize) this.ring.shift();
  }

  private updateSnapshot(event: ServerFeedEvent): void {
    // Only current-state kinds with a correlation key seed the snapshot map;
    // logs and heartbeats are transient and would just churn it.
    if (event.correlationId === undefined) return;
    if (event.kind !== 'progress' && event.kind !== 'status' && event.kind !== 'error') return;
    const key = `${event.source}:${event.correlationId}`;
    // Re-insert so Map iteration order tracks recency (oldest key evicts first).
    this.snapshots.delete(key);
    this.snapshots.set(key, event);
    if (this.snapshots.size > this.snapshotCap) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest !== undefined) this.snapshots.delete(oldest);
    }
  }

  private fanOut(event: ServerFeedEvent): void {
    for (const sub of this.listeners) {
      if (!matches(event, sub.filter)) continue;
      try {
        sub.listener(event);
      } catch {
        // A listener throwing must not break delivery to the others.
      }
    }
  }
}
