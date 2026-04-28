/**
 * Per-Check counters. The evaluator mutates this in place; the caller reads it
 * once at the end and forwards it to whatever telemetry sink is wired up via
 * {@link CheckMetricsSink}.
 */
export interface CheckMetrics {
    /** Total wall-clock time of the Check in milliseconds. */
    durationMs: number;
    /** Count of `repo.listByObjectRelation` calls made during this Check. */
    tupleReads: number;
    /** Count of `repo.listObjectsRelatedBy` calls made during this Check. */
    parentLookups: number;
    /** Count of memo (per-request cache) hits. */
    cacheHits: number;
    /** Greatest recursion depth reached during evaluation. */
    maxDepth: number;
    /** True if the evaluator hit the configured max-depth guard. */
    hitMaxDepth: boolean;
}

/**
 * Build a fresh, zeroed {@link CheckMetrics} record. The Check evaluator
 * creates one per request; sinks should not need to call this directly.
 */
export const newCheckMetrics = (): CheckMetrics => ({
    durationMs: 0,
    tupleReads: 0,
    parentLookups: 0,
    cacheHits: 0,
    maxDepth: 0,
    hitMaxDepth: false,
});

/**
 * Tags attached to each Check observation. Use these as low-cardinality
 * dimensions when forwarding to a metrics backend.
 */
export interface CheckMetricsTags {
    namespace: string;
    permission: string;
    allowed: boolean;
}

/**
 * Pluggable sink that receives one observation per Check. Default is
 * {@link NoopMetricsSink}; production wires this to whatever telemetry
 * backend is in use (DataDog, OpenTelemetry, log-based metrics, etc.).
 *
 * Modeled as an abstract class so the runtime reference is a valid InjectKit
 * token (interfaces aren't preserved at runtime).
 */
export abstract class CheckMetricsSink {
    abstract record(metrics: CheckMetrics, tags: CheckMetricsTags): void;
}

/**
 * Sink that drops observations on the floor. Used by {@link check} when the
 * caller doesn't pass a sink.
 */
export class NoopMetricsSink extends CheckMetricsSink {
    record(): void {}
}

/**
 * Singleton instance of {@link NoopMetricsSink}. Reuse this rather than
 * allocating a new noop sink per Check.
 */
export const noopMetricsSink: CheckMetricsSink = new NoopMetricsSink();
