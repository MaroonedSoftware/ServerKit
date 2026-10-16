import { ValueType } from '@opentelemetry/api';
import { millisToHrTime } from '@opentelemetry/core';
import { defaultResource, Resource } from '@opentelemetry/resources';
import { AggregationTemporality, DataPointType, MetricData, PushMetricExporter } from '@opentelemetry/sdk-metrics';
import { MetricBucket } from './metric.bucket.js';
import { exportAsPromise } from './otlp.export.js';

/**
 * How a metric is sent over OTLP. The stored aggregate is the same for all three; this only says
 * which part of it a collector should see.
 *
 * - `gauge` sends `last`.
 * - `counter` sends `sum` as a monotonic delta sum.
 * - `histogram` sends `count`, `sum`, `min` and `max` as a delta histogram with no bucket boundaries.
 */
export type MetricKind = 'gauge' | 'counter' | 'histogram';

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
}

const MINUTE_MS = 60_000;

/**
 * Sends drained minute buckets to an OTLP exporter as already-aggregated data.
 *
 * It does not go through a `MeterProvider`: the buckets are already aggregates, and recording them
 * into SDK instruments would aggregate them a second time. Each bucket becomes one data point
 * spanning its minute, with delta temporality, so a collector that wants cumulative series (a
 * Prometheus exporter, say) needs its `deltatocumulative` processor.
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

  /**
   * @param options - The exporter, resource, scope and kind picker.
   */
  constructor(options: OtlpMetricsBridgeOptions) {
    this.exporter = options.exporter;
    this.resource = options.resource ?? defaultResource();
    this.scope = options.scope ?? '@maroonedsoftware/telemetry';
    this.kindOf = options.kindOf ?? (() => 'gauge');
  }

  /**
   * Exports the buckets, one OTel metric per name.
   *
   * @param buckets - What a recorder drained.
   * @throws Whatever the exporter reports when it fails.
   */
  async export(buckets: readonly MetricBucket[]): Promise<void> {
    if (buckets.length === 0) {
      return;
    }
    const byName = new Map<string, MetricBucket[]>();
    for (const bucket of buckets) {
      byName.set(bucket.name, [...(byName.get(bucket.name) ?? []), bucket]);
    }
    const metrics = [...byName.entries()].map(([name, group]) => this.metricOf(name, group));
    await exportAsPromise(done => this.exporter.export({ resource: this.resource, scopeMetrics: [{ scope: { name: this.scope }, metrics }] }, done));
  }

  /** Flushes and closes the exporter. */
  async shutdown(): Promise<void> {
    await this.exporter.shutdown();
  }

  private metricOf(name: string, buckets: MetricBucket[]): MetricData {
    const descriptor = { name, description: '', unit: '', valueType: ValueType.DOUBLE };
    const timing = (bucket: MetricBucket) => ({
      startTime: millisToHrTime(bucket.start.toMillis()),
      endTime: millisToHrTime(bucket.start.toMillis() + MINUTE_MS),
      attributes: { ...bucket.labels },
    });
    switch (this.kindOf(name)) {
      case 'counter':
        return {
          descriptor,
          aggregationTemporality: AggregationTemporality.DELTA,
          dataPointType: DataPointType.SUM,
          isMonotonic: true,
          dataPoints: buckets.map(bucket => ({ ...timing(bucket), value: bucket.aggregate.sum })),
        };
      case 'histogram':
        return {
          descriptor,
          aggregationTemporality: AggregationTemporality.DELTA,
          dataPointType: DataPointType.HISTOGRAM,
          dataPoints: buckets.map(bucket => ({
            ...timing(bucket),
            value: {
              buckets: { boundaries: [], counts: [bucket.aggregate.count] },
              count: bucket.aggregate.count,
              sum: bucket.aggregate.sum,
              min: bucket.aggregate.min,
              max: bucket.aggregate.max,
            },
          })),
        };
      case 'gauge':
        return {
          descriptor,
          aggregationTemporality: AggregationTemporality.CUMULATIVE,
          dataPointType: DataPointType.GAUGE,
          dataPoints: buckets.map(bucket => ({ ...timing(bucket), value: bucket.aggregate.last })),
        };
    }
  }
}
