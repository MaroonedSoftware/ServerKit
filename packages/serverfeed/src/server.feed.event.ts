/**
 * The wire contract for the realtime server feed. Pure data — no Node, DB, or
 * framework types — so the same shape is shared by the publisher (the API), the
 * transport (SSE), and the consumer (a web console). The SSE endpoint sits outside
 * any schema codegen, so this hand-shared type is the single source of truth for an
 * event on the wire.
 */

/** Severity of an event, ordered debug < info < warn < error. */
export type ServerFeedLevel = 'debug' | 'info' | 'warn' | 'error';

/** What an event reports. */
export type ServerFeedKind = 'progress' | 'status' | 'log' | 'error' | 'heartbeat';

/** Progress of a multi-step operation (e.g. writing segment 4/8 of a script). */
export interface ServerFeedProgress {
  /** Human phase label, e.g. 'gathering', 'writing', 'rendering'. */
  phase: string;
  /** Step index within the phase (0 when not step-oriented). */
  index: number;
  /** Total steps (0 when unknown). */
  total: number;
  status: 'running' | 'done' | 'failed';
}

/** One event on the feed. `id` and `ts` are assigned by the bus. */
export interface ServerFeedEvent {
  /** Monotonic, process-lifetime id — the Last-Event-ID resume key. */
  id: number;
  /** ISO-8601 timestamp assigned at publish. */
  ts: string;
  /** Emitter, e.g. 'render' | 'llm' | 'tts' | 'jobs' | 'director' | 'health' | 'log'. */
  source: string;
  level: ServerFeedLevel;
  kind: ServerFeedKind;
  /** Short human-readable message. */
  message?: string;
  /** Groups related events: show slug, episode slot, job id, LLM call id, … */
  correlationId?: string;
  progress?: ServerFeedProgress;
  /** Arbitrary structured payload (kept small — it rides the ring buffer). */
  data?: Record<string, unknown>;
}

/** A publisher-supplied event: the bus fills in `id` and (unless given) `ts`. */
export type ServerFeedEventInput = Omit<ServerFeedEvent, 'id' | 'ts'> & { ts?: string };

/** A subscription/replay filter. Every present field must match (AND semantics). */
export interface ServerFeedFilter {
  /** Match any of these sources (a single string matches that one source). */
  source?: string | string[];
  correlationId?: string;
  /** Minimum severity (inclusive), by the debug < info < warn < error order. */
  level?: ServerFeedLevel;
  /** Match any of these kinds (a single kind matches that one). */
  kind?: ServerFeedKind | ServerFeedKind[];
}

const LEVEL_RANK: Record<ServerFeedLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Numeric rank for a level, for min-severity comparisons. */
export function levelRank(level: ServerFeedLevel): number {
  return LEVEL_RANK[level];
}

/** True when `event` satisfies every present field of `filter` (AND semantics). */
export function matches(event: ServerFeedEvent, filter?: ServerFeedFilter): boolean {
  if (!filter) return true;
  if (filter.source !== undefined) {
    const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
    if (sources.length > 0 && !sources.includes(event.source)) return false;
  }
  if (filter.correlationId !== undefined && event.correlationId !== filter.correlationId) return false;
  if (filter.level !== undefined && levelRank(event.level) < levelRank(filter.level)) return false;
  if (filter.kind !== undefined) {
    const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
    if (kinds.length > 0 && !kinds.includes(event.kind)) return false;
  }
  return true;
}
