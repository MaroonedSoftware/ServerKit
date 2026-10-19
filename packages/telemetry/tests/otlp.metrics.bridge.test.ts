import { describe, it, expect } from 'vitest';
import { ExportResultCode } from '@opentelemetry/core';
import { JsonMetricsSerializer } from '@opentelemetry/otlp-transformer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AggregationTemporality, DataPoint, DataPointType, InMemoryMetricExporter, PushMetricExporter } from '@opentelemetry/sdk-metrics';
import { DateTime } from 'luxon';
import { aggregateOf, mergeAggregates } from '../src/metric.aggregate.js';
import { MetricBucket } from '../src/metric.bucket.js';
import { labelsKey } from '../src/metric.labels.js';
import { MetricKind, OtlpMetricsBridge } from '../src/otlp.metrics.bridge.js';

const start = DateTime.fromISO('2026-10-16T12:00:00Z', { zone: 'utc' });
const bucket = (name: string, values: number[], labels: Record<string, string> = {}, minute = 0): MetricBucket => ({
  name,
  labels,
  labelsKey: labelsKey(labels),
  start: start.plus({ minutes: minute }),
  aggregate: values.map(aggregateOf).reduce(mergeAggregates),
});

const kinds: Record<string, MetricKind> = { 'work.job.ms': 'histogram', 'model.tokens': 'counter' };

const exportOne = async (buckets: MetricBucket[]) => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
  const bridge = new OtlpMetricsBridge({
    exporter,
    resource: resourceFromAttributes({ 'service.name': 'test.app' }),
    kindOf: name => kinds[name] ?? 'gauge',
  });
  await bridge.export(buckets);
  return exporter.getMetrics();
};

describe('OtlpMetricsBridge', () => {
  it('sends one metric per name under the given resource, each bucket a point spanning its minute', async () => {
    const [exported] = await exportOne([bucket('station.listeners', [4, 7]), bucket('station.listeners', [9], {}, 1)]);

    expect(exported?.resource.attributes['service.name']).toBe('test.app');
    const [metric] = exported?.scopeMetrics[0]?.metrics ?? [];
    expect(metric?.descriptor.name).toBe('station.listeners');
    expect(metric?.dataPointType).toBe(DataPointType.GAUGE);
    expect(metric?.dataPoints.map(p => p.value)).toEqual([7, 9]);
    expect(metric?.dataPoints[0]?.startTime).toEqual([start.toSeconds(), 0]);
    expect(metric?.dataPoints[0]?.endTime).toEqual([start.toSeconds() + 60, 0]);
  });

  it('sends a counter as a monotonic delta sum of the bucket', async () => {
    const [exported] = await exportOne([bucket('model.tokens', [100, 50], { kind: 'break' })]);
    const metric = exported?.scopeMetrics[0]?.metrics[0];

    expect(metric?.dataPointType).toBe(DataPointType.SUM);
    expect(metric?.aggregationTemporality).toBe(AggregationTemporality.DELTA);
    expect(metric?.dataPointType === DataPointType.SUM && metric.isMonotonic).toBe(true);
    expect(metric?.dataPoints[0]?.value).toBe(150);
    expect(metric?.dataPoints[0]?.attributes).toEqual({ kind: 'break' });
  });

  it('sends a histogram as count, sum, min and max with a single bucket', async () => {
    const [exported] = await exportOne([bucket('work.job.ms', [10, 30, 20])]);
    const metric = exported?.scopeMetrics[0]?.metrics[0];

    expect(metric?.dataPointType).toBe(DataPointType.HISTOGRAM);
    expect(metric?.dataPoints[0]?.value).toEqual({ buckets: { boundaries: [], counts: [3] }, count: 3, sum: 60, min: 10, max: 30 });
  });

  it('serialises through the OTLP JSON encoding an OTLP/HTTP exporter sends', async () => {
    const [exported] = await exportOne([bucket('work.job.ms', [10, 30], { queue: 'a' }), bucket('station.listeners', [3])]);
    if (exported === undefined) {
      throw new Error('nothing exported');
    }

    const body = JSON.parse(new TextDecoder().decode(JsonMetricsSerializer.serializeRequest(exported)));
    const [histogram, gauge] = body.resourceMetrics[0].scopeMetrics[0].metrics;
    expect(histogram.name).toBe('work.job.ms');
    expect(histogram.histogram.dataPoints[0]).toMatchObject({ count: 2, sum: 40, min: 10, max: 30 });
    expect(gauge.gauge.dataPoints[0].asDouble).toBe(3);
  });

  describe('cumulative', () => {
    const cumulative = () => {
      const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
      const bridge = new OtlpMetricsBridge({ exporter, kindOf: name => kinds[name] ?? 'gauge', temporality: 'cumulative' });
      const points = (name: string) =>
        exporter
          .getMetrics()
          .flatMap(resource => resource.scopeMetrics.flatMap(scope => scope.metrics))
          .filter(metric => metric.descriptor.name === name)
          .flatMap((metric): DataPoint<unknown>[] => metric.dataPoints);
      return { exporter, bridge, points };
    };
    const seconds = (minutes: number) => start.plus({ minutes }).toSeconds();

    it('sends running totals from a fixed start, one point per series per export', async () => {
      const { exporter, bridge, points } = cumulative();
      await bridge.export([bucket('model.tokens', [100], { kind: 'a' }), bucket('model.tokens', [5], { kind: 'b' })], start.plus({ seconds: 70 }));
      await bridge.export(
        [bucket('model.tokens', [50], { kind: 'a' }, 1), bucket('model.tokens', [25], { kind: 'a' }, 2)],
        start.plus({ minutes: 3 }),
      );

      const metric = exporter.getMetrics()[0]?.scopeMetrics[0]?.metrics[0];
      expect(metric?.aggregationTemporality).toBe(AggregationTemporality.CUMULATIVE);
      expect(points('model.tokens').map(p => [p.attributes['kind'], p.value, p.startTime[0], p.endTime[0]])).toEqual([
        ['a', 100, seconds(0), seconds(0) + 70],
        ['b', 5, seconds(0), seconds(0) + 70],
        ['a', 175, seconds(0), seconds(3)],
      ]);
    });

    it('adds up a minute exported in parts, and keeps end times rising', async () => {
      const { bridge, points } = cumulative();
      const now = start.plus({ seconds: 30 });
      await bridge.export([bucket('work.job.ms', [10, 30])], now);
      await bridge.export([bucket('work.job.ms', [20])], now);

      const [first, second] = points('work.job.ms');
      expect(second?.value).toEqual({ buckets: { boundaries: [], counts: [3] }, count: 3, sum: 60, min: 10, max: 30 });
      expect(second!.endTime[0] * 1e9 + second!.endTime[1]).toBeGreaterThan(first!.endTime[0] * 1e9 + first!.endTime[1]);
    });

    it('sends a gauge’s latest reading rather than a total', async () => {
      const { bridge, points } = cumulative();
      await bridge.export([bucket('station.listeners', [4], {}, 1), bucket('station.listeners', [9], {}, 0)], start.plus({ minutes: 2 }));

      expect(points('station.listeners').map(p => p.value)).toEqual([4]);
    });

    it('catches a failed export up on the next one', async () => {
      let fail = true;
      const sent: number[] = [];
      const exporter: PushMetricExporter = {
        export: (metrics, done) => {
          if (fail) {
            done({ code: ExportResultCode.FAILED, error: new Error('down') });
            return;
          }
          sent.push(...metrics.scopeMetrics.flatMap(scope => scope.metrics.flatMap(metric => metric.dataPoints.map(p => p.value as number))));
          done({ code: ExportResultCode.SUCCESS });
        },
        forceFlush: async () => {},
        shutdown: async () => {},
      };
      const bridge = new OtlpMetricsBridge({ exporter, kindOf: () => 'counter', temporality: 'cumulative' });

      await expect(bridge.export([bucket('a', [2])], start.plus({ minutes: 1 }))).rejects.toThrow('down');
      fail = false;
      await bridge.export([bucket('a', [3], {}, 1)], start.plus({ minutes: 2 }));
      expect(sent).toEqual([5]);
    });
  });

  it('exports nothing for no buckets', async () => {
    expect(await exportOne([])).toEqual([]);
  });

  it('rejects with the exporter’s error when the export fails', async () => {
    const failure = new Error('collector unreachable');
    const exporter: PushMetricExporter = {
      export: (_metrics, done) => done({ code: ExportResultCode.FAILED, error: failure }),
      forceFlush: async () => {},
      shutdown: async () => {},
    };

    await expect(new OtlpMetricsBridge({ exporter }).export([bucket('a', [1])])).rejects.toBe(failure);
  });
});
