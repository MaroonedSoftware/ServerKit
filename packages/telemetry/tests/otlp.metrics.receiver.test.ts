import { describe, it, expect } from 'vitest';
import { JsonMetricsSerializer } from '@opentelemetry/otlp-transformer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { DateTime } from 'luxon';
import { aggregateOf, mergeAggregates } from '../src/metric.aggregate.js';
import { labelsKey } from '../src/metric.labels.js';
import { OtlpMetricsBridge } from '../src/otlp.metrics.bridge.js';
import { OtlpMetricsReceiver, OtlpPayloadError } from '../src/otlp.metrics.receiver.js';

const T0 = DateTime.fromISO('2026-10-16T12:00:00Z', { zone: 'utc' });
const nanos = (at: DateTime) => `${at.toMillis()}000000`;
const attrs = (labels: Record<string, string>) => Object.entries(labels).map(([key, value]) => ({ key, value: { stringValue: value } }));

const request = (metrics: unknown[], service = 'ytaudio') => ({
  resourceMetrics: [
    { resource: { attributes: attrs({ 'service.name': service, 'host.name': 'box' }) }, scopeMetrics: [{ scope: { name: 's' }, metrics }] },
  ],
});
const gauge = (name: string, value: number, at = T0, labels: Record<string, string> = {}) => ({
  name,
  gauge: { dataPoints: [{ attributes: attrs(labels), timeUnixNano: nanos(at), asDouble: value }] },
});
const cumulativeSum = (name: string, value: number, at: DateTime, start = T0) => ({
  name,
  sum: {
    aggregationTemporality: 2,
    isMonotonic: true,
    dataPoints: [{ startTimeUnixNano: nanos(start), timeUnixNano: nanos(at), asInt: String(value) }],
  },
});

describe('OtlpMetricsReceiver', () => {
  it('refuses a body that is not a metrics export', () => {
    expect(() => new OtlpMetricsReceiver().receive({ resourceSpans: [] })).toThrow(OtlpPayloadError);
    expect(() => new OtlpMetricsReceiver().receive('nope')).toThrow(OtlpPayloadError);
  });

  it('reads a gauge point into its minute, labelled with the point attributes over service.name only', () => {
    const { buckets } = new OtlpMetricsReceiver().receive(request([gauge('queue.depth', 4, T0.plus({ seconds: 30 }), { queue: 'a' })]));

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ name: 'queue.depth', labels: { 'service.name': 'ytaudio', queue: 'a' }, aggregate: aggregateOf(4) });
    expect(buckets[0]?.start.toISO()).toBe('2026-10-16T12:00:00.000Z');
  });

  it('turns a cumulative monotonic sum into increases, the first point only setting the baseline', () => {
    const receiver = new OtlpMetricsReceiver();

    expect(receiver.receive(request([cumulativeSum('requests', 100, T0)])).buckets).toEqual([]);
    expect(receiver.receive(request([cumulativeSum('requests', 130, T0.plus({ minutes: 1 }))])).buckets[0]?.aggregate.sum).toBe(30);
    expect(receiver.receive(request([cumulativeSum('requests', 135, T0.plus({ minutes: 2 }))])).buckets[0]?.aggregate.sum).toBe(5);
  });

  it('treats a new start time or a smaller total as a sender restart, and re-baselines', () => {
    const receiver = new OtlpMetricsReceiver();
    receiver.receive(request([cumulativeSum('requests', 100, T0)]));

    expect(receiver.receive(request([cumulativeSum('requests', 3, T0.plus({ minutes: 1 }), T0.plus({ minutes: 1 }))])).buckets).toEqual([]);
    expect(
      receiver.receive(request([cumulativeSum('requests', 8, T0.plus({ minutes: 2 }), T0.plus({ minutes: 1 }))])).buckets[0]?.aggregate.sum,
    ).toBe(5);
  });

  it('reads a delta sum and a non-monotonic sum as one observation of their value', () => {
    const { buckets } = new OtlpMetricsReceiver().receive(
      request([
        {
          name: 'delta',
          sum: { aggregationTemporality: 'AGGREGATION_TEMPORALITY_DELTA', isMonotonic: true, dataPoints: [{ timeUnixNano: nanos(T0), asDouble: 7 }] },
        },
        { name: 'updown', sum: { aggregationTemporality: 2, isMonotonic: false, dataPoints: [{ timeUnixNano: nanos(T0), asInt: '-3' }] } },
      ]),
    );

    expect(buckets.map(b => [b.name, b.aggregate.sum])).toEqual([
      ['delta', 7],
      ['updown', -3],
    ]);
  });

  it('reads a delta histogram with its extremes, and a cumulative one as interval increases at its mean', () => {
    const receiver = new OtlpMetricsReceiver();
    const histogram = (temporality: number, count: number, sum: number, extra: object = {}) => ({
      name: 'latency.ms',
      histogram: {
        aggregationTemporality: temporality,
        dataPoints: [{ startTimeUnixNano: nanos(T0), timeUnixNano: nanos(T0), count: String(count), sum, ...extra }],
      },
    });

    expect(receiver.receive(request([histogram(1, 4, 100, { min: 5, max: 60 })])).buckets[0]?.aggregate).toEqual({
      count: 4,
      sum: 100,
      min: 5,
      max: 60,
      last: 25,
    });

    receiver.receive(request([histogram(2, 10, 200)], 'other'));
    expect(receiver.receive(request([histogram(2, 14, 260)], 'other')).buckets[0]?.aggregate).toEqual({
      count: 4,
      sum: 60,
      min: 15,
      max: 15,
      last: 15,
    });
  });

  it('counts exponential histograms, summaries and malformed points as unsupported', () => {
    const result = new OtlpMetricsReceiver().receive(
      request([
        { name: 'exp', exponentialHistogram: { dataPoints: [{}, {}] } },
        { name: 'summary', summary: { dataPoints: [{}] } },
        { name: 'bad', gauge: { dataPoints: [{ timeUnixNano: nanos(T0) }] } },
        { gauge: { dataPoints: [] } },
      ]),
    );

    expect(result).toMatchObject({ buckets: [], unsupported: 5, dropped: 0 });
  });

  it('caps label sets per name and names overall, for the receiver’s whole life', () => {
    const receiver = new OtlpMetricsReceiver({ maxSeriesPerName: 2, maxNames: 2 });
    const first = receiver.receive(request(['a', 'b', 'c'].map(id => gauge('per.request', 1, T0, { id }))));
    const later = receiver.receive(request([gauge('per.request', 1, T0, { id: 'd' }), gauge('per.request', 1, T0, { id: 'a' })]));
    const names = receiver.receive(request([gauge('second', 1), gauge('third', 1)]));

    expect([first.buckets.length, first.dropped]).toEqual([2, 1]);
    expect([later.buckets.length, later.dropped]).toEqual([1, 1]);
    expect(names.buckets.map(b => b.name)).toEqual(['second']);
  });

  it('merges points of one series and minute, and uses now for a point with no timestamp', () => {
    const now = T0.plus({ hours: 1, seconds: 5 });
    const { buckets } = new OtlpMetricsReceiver().receive(
      request([{ name: 'g', gauge: { dataPoints: [{ asDouble: 1 }, { asDouble: 3, timeUnixNano: '0' }] } }]),
      now,
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.aggregate).toEqual(mergeAggregates(aggregateOf(1), aggregateOf(3)));
    expect(buckets[0]?.start.toISO()).toBe('2026-10-16T13:00:00.000Z');
  });

  it('reads back what the OTel JSON serializer writes for this package’s own bridge', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
    const bridge = new OtlpMetricsBridge({
      exporter,
      resource: resourceFromAttributes({ 'service.name': 'sender' }),
      kindOf: name => (name === 'work.job.ms' ? 'histogram' : name === 'tokens' ? 'counter' : 'gauge'),
    });
    const bucket = (name: string, values: number[]) => ({
      name,
      labels: { queue: 'a' },
      labelsKey: labelsKey({ queue: 'a' }),
      start: T0,
      aggregate: values.map(aggregateOf).reduce(mergeAggregates),
    });
    await bridge.export([bucket('work.job.ms', [10, 30]), bucket('tokens', [5, 7]), bucket('listeners', [2, 4])]);
    const [sent] = exporter.getMetrics();
    if (sent === undefined) {
      throw new Error('nothing exported');
    }

    const body = JSON.parse(new TextDecoder().decode(JsonMetricsSerializer.serializeRequest(sent)));
    const { buckets, unsupported } = new OtlpMetricsReceiver().receive(body);

    expect(unsupported).toBe(0);
    expect(Object.fromEntries(buckets.map(b => [b.name, b.aggregate]))).toEqual({
      'work.job.ms': { count: 2, sum: 40, min: 10, max: 30, last: 20 },
      tokens: aggregateOf(12),
      listeners: aggregateOf(4),
    });
    expect(buckets[0]?.labels).toEqual({ 'service.name': 'sender', queue: 'a' });
  });
});
