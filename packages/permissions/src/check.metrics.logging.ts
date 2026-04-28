import { CheckMetricsSink, type CheckMetrics, type CheckMetricsTags } from './check.metrics.js';

/**
 * Minimal {@link CheckMetricsSink} that emits one structured-log line per
 * Check. Suitable for log-based metrics tooling until a proper telemetry
 * pipeline lands.
 *
 * The shape is single-line JSON so log collectors can parse it without extra
 * configuration; promote any of the fields to a real metric dashboard once
 * one exists.
 */
export class LoggingMetricsSink extends CheckMetricsSink {
    record(metrics: CheckMetrics, tags: CheckMetricsTags): void {
        console.log(
            JSON.stringify({
                event: 'permissions.check',
                namespace: tags.namespace,
                permission: tags.permission,
                allowed: tags.allowed,
                duration_ms: metrics.durationMs,
                tuple_reads: metrics.tupleReads,
                parent_lookups: metrics.parentLookups,
                cache_hits: metrics.cacheHits,
                max_depth: metrics.maxDepth,
                hit_max_depth: metrics.hitMaxDepth,
            }),
        );
    }
}
