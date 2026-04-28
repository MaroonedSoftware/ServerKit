import { describe, it, expect } from 'vitest';
import {
    CheckMetricsSink,
    NoopMetricsSink,
    newCheckMetrics,
    noopMetricsSink,
} from '../src/check.metrics.js';
import { LoggingMetricsSink } from '../src/check.metrics.logging.js';

describe('newCheckMetrics', () => {
    it('returns zeroed counters', () => {
        expect(newCheckMetrics()).toEqual({
            durationMs: 0,
            tupleReads: 0,
            parentLookups: 0,
            cacheHits: 0,
            maxDepth: 0,
            hitMaxDepth: false,
        });
    });

    it('returns a fresh object on each call', () => {
        const a = newCheckMetrics();
        a.tupleReads = 5;
        expect(newCheckMetrics().tupleReads).toBe(0);
    });
});

describe('NoopMetricsSink', () => {
    it('extends CheckMetricsSink', () => {
        expect(noopMetricsSink).toBeInstanceOf(CheckMetricsSink);
        expect(noopMetricsSink).toBeInstanceOf(NoopMetricsSink);
    });

    it('record() is a no-op', () => {
        expect(() => noopMetricsSink.record(newCheckMetrics(), { namespace: 'doc', permission: 'view', allowed: true })).not.toThrow();
    });
});

describe('LoggingMetricsSink', () => {
    it('writes a single-line JSON record to console.log', () => {
        const sink = new LoggingMetricsSink();
        const calls: string[] = [];
        const original = console.log;
        console.log = (msg: unknown) => {
            calls.push(String(msg));
        };
        try {
            const metrics = newCheckMetrics();
            metrics.durationMs = 1.5;
            metrics.tupleReads = 2;
            metrics.parentLookups = 1;
            metrics.cacheHits = 3;
            metrics.maxDepth = 4;
            metrics.hitMaxDepth = true;
            sink.record(metrics, { namespace: 'doc', permission: 'view', allowed: true });
        } finally {
            console.log = original;
        }

        expect(calls).toHaveLength(1);
        const payload = JSON.parse(calls[0]!);
        expect(payload).toEqual({
            event: 'permissions.check',
            namespace: 'doc',
            permission: 'view',
            allowed: true,
            duration_ms: 1.5,
            tuple_reads: 2,
            parent_lookups: 1,
            cache_hits: 3,
            max_depth: 4,
            hit_max_depth: true,
        });
    });
});
