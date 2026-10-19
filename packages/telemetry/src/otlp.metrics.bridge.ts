import { ValueType } from '@opentelemetry/api';
import { millisToHrTime } from '@opentelemetry/core';
import { defaultResource, Resource } from '@opentelemetry/resources';
import { AggregationTemporality, DataPointType, MetricData, PushMetricExporter } from '@opentelemetry/sdk-metrics';
import { DateTime } from 'luxon';
import { MetricAggregate, mergeAggregates } from './metric.aggregate.js';
import { MetricBucket } from './metric.bucket.js';
import { exportAsPromise } from './otlp.export.js';

/**
 * How a metric is sent over OTLP. The stored aggregate is the same for all three; this only says
 * which part of it a collector should see.
 *
 * - `gauge` sends `last`.
 * - `counter` sends `sum` as a monotonic sum.
 * - `histogram` sends `count`, `sum`, `min` and `max` as a histogram with no bucket boundaries.
 *
 * Counters and histograms go out with the bridge's {@link MetricTemporality}.
 */
export type MetricKind = 'gauge' | 'counter' | 'histogram';

/**
 * How counters and histograms are reported.
 *
 * - `delta`: each bucket is one point spanning its minute. A collector feeding a store that keeps
 *   only cumulative series (Prometheus, Google Cloud Managed Service for Prometheus) needs its
 *   `deltatocumulative` processor, and each minute must be exported once (`drainClosed`).
 * - `cumulative`: the bridge keeps a running total per series for its life, and each export sends
 *   one point per series it touched, from the series' first minute to the export time. A minute
 *   exported in parts adds up, and a failed export is caught up by the next one.
 */
export type MetricTemporality = 'delta' | 'cumulative';

/**
 * How an {@link OtlpMetricsBridge} is built.
 */
export interface OtlpMetricsBridgeOptions {
  /** Where the metrics go: an `OTLPMetricExporter`, or `InMemoryMetricExporter` in tests. */
  exporter: PushMetricExporter;
  /** Says who is sending. Defaults to the SDK's default resource. */
  resource?: Resource;
  /** The instrumentation scope name. Defaults to `@maroonedsoftware/telemetry`. */
  scope?: string;
  /** Picks each metric's kind by name. Defaults to `gauge` for everything. */
  kindOf?: (name: string) => MetricKind;
  /** How counters and histograms are reported. Defaults to `delta`. */
  temporality?: MetricTemporality;
}

const MINUTE_MS = 60_000;

/** A cumulative series' running state: when it started, everything seen, and when it was last sent. */
interface CumulativeSeries {
  startMillis: number;
  aggregate: MetricAggregate;
  sentMillis: number;
}

/** A point's series, its time range and its aggregate, before it is shaped for its kind. */
interface PointOf {
  labels: MetricBucket['labels'];
  startMillis: number;
  endMillis: number;
  aggregate: MetricAggregate;
}

/**
 * Sends drained minute buckets to an OTLP exporter as already-aggregated data.
 *
 * It does not go through a `MeterProvider`: the buckets are already aggregates, and recording them
 * into SDK instruments would aggregate them a second time. With `delta` temporality (the default)
 * each bucket becomes one data point spanning its minute; with `cumulative`, each series gets one
 * point per export carrying its running total (see {@link MetricTemporality}).
 *
 * @example
 * ```typescript
 * const bridge = new OtlpMetricsBridge({
 *   exporter: new OTLPMetricExporter({ url }),
 *   resource: resourceFromAttributes({ 'service.name': 'my.app' }),
 *   kindOf: name => (name.endsWith('.ms') ? 'histogram' : 'gauge'),
 * });
 * await bridge.export(buckets);
 * ```
 */
export class OtlpMetricsBridge {
  private readonly exporter: PushMetricExporter;
  private readonly resource: Resource;
  private readonly scope: string;
  private readonly kindOf: (name: string) => MetricKind;
  private readonly temporality: MetricTemporality;
  /** Cumulative mode's running series, by name and labels. Grows with label cardinality. */
  private readonly series = new Map<string, CumulativeSeries>();

  /**
   * @param options - The exporter, resource, scope, kind picker and temporality.
   */
  constructor(options: OtlpMetricsBridgeOptions) {
    this.exporter = options.exporter;
    this.resource = options.resource ?? defaultResource();
    this.scope = options.scope ?? '@maroonedsoftware/telemetry';
    this.kindOf = options.kindOf ?? (() => 'gauge');
    this.temporality = options.temporality ?? 'delta';
  }

  /**
   * Exports the buckets, one OTel metric per name.
   *
   * In cumulative mode the buckets are folded into each series' running total first, so a failed
   * export loses nothing: the next one sends the totals including them.
   *
   * @param buckets - What a recorder drained.
   * @param now - The export time, a cumulative point's end. Defaults to now.
   * @throws Whatever the exporter reports when it fails.
   */
  async export(buckets: readonly MetricBucket[], now: DateTime = DateTime.now()): Promise<void> {
    if (buckets.length === 0) {
      return;
    }
    const byName = new Map<string, MetricBucket[]>();
    for (const bucket of buckets) {
      byName.set(bucket.name, [...(byName.get(bucket.name) ?? []), bucket]);
    }
    const metrics = [...byName.entries()].map(([name, group]) => {
      const kind = this.kindOf(name);
      const points = this.temporality === 'cumulative' ? this.cumulativePoints(name, kind, group, now.toMillis()) : group.map(deltaPoint);
      return this.metricOf(name, kind, points);
    });
    // A resource with attributes still being detected (a cloud metadata lookup) settles first, as the SDK's own processors do.
    await this.resource.waitForAsyncAttributes?.();
    await exportAsPromise(done => this.exporter.export({ resource: this.resource, scopeMetrics: [{ scope: { name: this.scope }, metrics }] }, done));
  }

  /** Flushes and closes the exporter. */
  async shutdown(): Promise<void> {
    await this.exporter.shutdown();
  }

  /**
   * One point per series in `buckets`: a gauge's latest reading, or a counter's or histogram's
   * running total. Each point ends at `nowMillis`, or just after the series' last point, so a
   * series' points never share an end time.
   */
  private cumulativePoints(name: string, kind: MetricKind, buckets: MetricBucket[], nowMillis: number): PointOf[] {
    const touched = new Map<string, { latest: MetricBucket; series: CumulativeSeries }>();
    for (const bucket of buckets) {
      const id = `${name}\u0000${bucket.labelsKey}`;
      const startMillis = bucket.start.toMillis();
      const existing = this.series.get(id);
      const series: CumulativeSeries = existing
        ? { ...existing, startMillis: Math.min(existing.startMillis, startMillis), aggregate: mergeAggregates(existing.aggregate, bucket.aggregate) }
        : { startMillis, aggregate: bucket.aggregate, sentMillis: startMillis };
      this.series.set(id, series);
      const latest = touched.get(id)?.latest;
      touched.set(id, { latest: latest && latest.start > bucket.start ? latest : bucket, series });
    }
    return [...touched.entries()].map(([id, { latest, series }]) => {
      const endMillis = Math.max(nowMillis, series.sentMillis + 1);
      this.series.set(id, { ...series, sentMillis: endMillis });
      // A gauge reports its latest reading, not a running total.
      return { labels: latest.labels, startMillis: series.startMillis, endMillis, aggregate: kind === 'gauge' ? latest.aggregate : series.aggregate };
    });
  }

  private metricOf(name: string, kind: MetricKind, points: PointOf[]): MetricData {
    const descriptor = { name, description: '', unit: '', valueType: ValueType.DOUBLE };
    const aggregationTemporality = this.temporality === 'cumulative' ? AggregationTemporality.CUMULATIVE : AggregationTemporality.DELTA;
    const timing = (point: PointOf) => ({
      startTime: millisToHrTime(point.startMillis),
      endTime: millisToHrTime(point.endMillis),
      attributes: { ...point.labels },
    });
    switch (kind) {
      case 'counter':
        return {
          descriptor,
          aggregationTemporality,
          dataPointType: DataPointType.SUM,
          isMonotonic: true,
          dataPoints: points.map(point => ({ ...timing(point), value: point.aggregate.sum })),
        };
      case 'histogram':
        return {
          descriptor,
          aggregationTemporality,
          dataPointType: DataPointType.HISTOGRAM,
          dataPoints: points.map(point => ({
            ...timing(point),
            value: {
              buckets: { boundaries: [], counts: [point.aggregate.count] },
              count: point.aggregate.count,
              sum: point.aggregate.sum,
              min: point.aggregate.min,
              max: point.aggregate.max,
            },
          })),
        };
      case 'gauge':
        return {
          descriptor,
          aggregationTemporality: AggregationTemporality.CUMULATIVE,
          dataPointType: DataPointType.GAUGE,
          dataPoints: points.map(point => ({ ...timing(point), value: point.aggregate.last })),
        };
    }
  }
}

/** A delta point: one bucket, spanning its minute. */
const deltaPoint = (bucket: MetricBucket): PointOf => ({
  labels: bucket.labels,
  startMillis: bucket.start.toMillis(),
  endMillis: bucket.start.toMillis() + MINUTE_MS,
  aggregate: bucket.aggregate,
});
