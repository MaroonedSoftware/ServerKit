import { DateTime } from 'luxon';
import { aggregateOf, MetricAggregate, mergeAggregates } from './metric.aggregate.js';
import { MetricBucket, minuteOf } from './metric.bucket.js';
import { labelsKey, MetricLabels } from './metric.labels.js';

/**
 * Thrown when a body is not an OTLP metrics export at all. A body that is one but carries parts this
 * receiver cannot use is not an error; those parts are counted in {@link OtlpReceiveResult}.
 */
export class OtlpPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtlpPayloadError';
  }
}

/**
 * How an {@link OtlpMetricsReceiver} bounds what it keeps.
 */
export interface OtlpMetricsReceiverOptions {
  /** Distinct label sets kept per metric name. Further series are dropped. Defaults to 50. */
  maxSeriesPerName?: number;
  /** Distinct metric names kept. Further names are dropped. Defaults to 500. */
  maxNames?: number;
}

/**
 * What one {@link OtlpMetricsReceiver.receive} call produced.
 */
export interface OtlpReceiveResult {
  /** Minute buckets, ready for a store. */
  buckets: MetricBucket[];
  /** Data points dropped by the series or name cap. */
  dropped: number;
  /** Data points of kinds this receiver does not read (exponential histograms, summaries), or malformed. */
  unsupported: number;
}

type Json = Record<string, unknown>;

const DELTA = 1;
const CUMULATIVE = 2;

interface CumulativeState {
  start: string;
  count: number;
  sum: number;
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const arrayOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** OTLP/JSON writes 64-bit integers as strings and doubles as numbers; either may carry a value. */
const numberOf = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

/** The enum is an integer in OTLP/JSON, but some encoders write its name. */
const temporalityOf = (value: unknown): number | undefined => {
  if (value === DELTA || value === 'AGGREGATION_TEMPORALITY_DELTA') {
    return DELTA;
  }
  if (value === CUMULATIVE || value === 'AGGREGATION_TEMPORALITY_CUMULATIVE') {
    return CUMULATIVE;
  }
  return undefined;
};

const attributeValueOf = (value: unknown): string | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  if (typeof value.stringValue === 'string') {
    return value.stringValue;
  }
  if (typeof value.boolValue === 'boolean') {
    return String(value.boolValue);
  }
  const numeric = numberOf(value.intValue) ?? numberOf(value.doubleValue);
  if (numeric !== undefined) {
    return String(numeric);
  }
  if (value.arrayValue !== undefined || value.kvlistValue !== undefined) {
    return JSON.stringify(value.arrayValue ?? value.kvlistValue);
  }
  return undefined;
};

const labelsOf = (attributes: unknown): Record<string, string> => {
  const labels: Record<string, string> = {};
  for (const attribute of arrayOf(attributes)) {
    if (isObject(attribute) && typeof attribute.key === 'string') {
      const value = attributeValueOf(attribute.value);
      if (value !== undefined) {
        labels[attribute.key] = value;
      }
    }
  }
  return labels;
};

const instantOf = (nanos: unknown, fallback: DateTime): DateTime => {
  if (typeof nanos !== 'string' && typeof nanos !== 'number') {
    return fallback;
  }
  try {
    const millis = Number(BigInt(nanos) / 1_000_000n);
    return millis > 0 ? DateTime.fromMillis(millis, { zone: 'utc' }) : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Turns OTLP/JSON metric exports (the body of `POST /v1/metrics` with `Content-Type: application/json`)
 * into minute buckets.
 *
 * - A **gauge** point, or a **non-monotonic sum** (an up-down counter), is one observation of its value.
 * - A **monotonic sum** contributes its increase. A delta point is the increase; a cumulative point is
 *   the difference from the previous point of the same series, so the first point of a series (and the
 *   first after the sender restarts, which shows as a new start time or a smaller total) only sets the
 *   baseline.
 * - A **histogram** contributes its count and sum the same way, with `min` and `max` when a delta point
 *   carries them. A cumulative histogram's extremes cover the sender's whole life, so they are replaced
 *   by the interval's mean.
 * - Exponential histograms and summaries are counted as unsupported.
 *
 * Labels are the point's attributes over the resource's `service.name`. Each name keeps at most
 * `maxSeriesPerName` label sets and the receiver at most `maxNames` names, for its whole life: a
 * sender that puts a request id in an attribute cannot grow the table without bound.
 *
 * Keep one instance per process. It holds the cumulative baselines, so a fresh instance costs every
 * cumulative series one point.
 */
export class OtlpMetricsReceiver {
  private readonly maxSeriesPerName: number;
  private readonly maxNames: number;
  private readonly series = new Map<string, Set<string>>();
  private readonly cumulative = new Map<string, CumulativeState>();

  /**
   * @param options - The series and name caps.
   */
  constructor(options: OtlpMetricsReceiverOptions = {}) {
    this.maxSeriesPerName = options.maxSeriesPerName ?? 50;
    this.maxNames = options.maxNames ?? 500;
  }

  /**
   * Reads one export request.
   *
   * @param body - The parsed JSON body.
   * @param now - Used for points with no timestamp. Defaults to now.
   * @throws {@link OtlpPayloadError} when the body has no `resourceMetrics` array.
   */
  receive(body: unknown, now: DateTime = DateTime.now()): OtlpReceiveResult {
    if (!isObject(body) || !Array.isArray(body.resourceMetrics)) {
      throw new OtlpPayloadError('Expected an OTLP metrics export with a resourceMetrics array');
    }
    const buckets = new Map<string, MetricBucket>();
    const result: OtlpReceiveResult = { buckets: [], dropped: 0, unsupported: 0 };

    const add = (name: string, labels: MetricLabels, at: DateTime, aggregate: MetricAggregate) => {
      const key = labelsKey(labels);
      const start = minuteOf(at);
      const id = `${name}\u0000${key}\u0000${start.toMillis()}`;
      const existing = buckets.get(id);
      buckets.set(
        id,
        existing === undefined
          ? { name, labels, labelsKey: key, start, aggregate }
          : { ...existing, aggregate: mergeAggregates(existing.aggregate, aggregate) },
      );
    };

    for (const resourceMetrics of body.resourceMetrics) {
      if (!isObject(resourceMetrics)) {
        continue;
      }
      const resource = labelsOf(isObject(resourceMetrics.resource) ? resourceMetrics.resource.attributes : undefined);
      const base: Record<string, string> = resource['service.name'] === undefined ? {} : { 'service.name': resource['service.name'] };

      for (const scopeMetrics of arrayOf(resourceMetrics.scopeMetrics)) {
        for (const metric of isObject(scopeMetrics) ? arrayOf(scopeMetrics.metrics) : []) {
          if (!isObject(metric) || typeof metric.name !== 'string' || metric.name === '') {
            result.unsupported += 1;
            continue;
          }
          const name = metric.name;
          const shape = isObject(metric.gauge)
            ? metric.gauge
            : isObject(metric.sum)
              ? metric.sum
              : isObject(metric.histogram)
                ? metric.histogram
                : undefined;
          if (shape === undefined) {
            const other = isObject(metric.exponentialHistogram) ? metric.exponentialHistogram : isObject(metric.summary) ? metric.summary : undefined;
            result.unsupported += Math.max(1, arrayOf(other?.dataPoints).length);
            continue;
          }
          const temporality = temporalityOf(shape.aggregationTemporality);
          const monotonic = shape === metric.sum && shape.isMonotonic === true;

          for (const point of arrayOf(shape.dataPoints)) {
            if (!isObject(point)) {
              result.unsupported += 1;
              continue;
            }
            const labels: MetricLabels = { ...base, ...labelsOf(point.attributes) };
            if (!this.admit(name, labelsKey(labels))) {
              result.dropped += 1;
              continue;
            }
            const at = instantOf(point.timeUnixNano, now);
            const seriesId = `${name}\u0000${labelsKey(labels)}`;
            const start = String(point.startTimeUnixNano ?? '');

            if (shape === metric.histogram) {
              const count = numberOf(point.count);
              const sum = numberOf(point.sum);
              if (count === undefined || sum === undefined) {
                result.unsupported += 1;
                continue;
              }
              if (temporality === CUMULATIVE) {
                const increase = this.increase(seriesId, start, sum, count);
                if (increase !== undefined && increase.count > 0) {
                  const mean = increase.sum / increase.count;
                  add(name, labels, at, { count: increase.count, sum: increase.sum, min: mean, max: mean, last: mean });
                }
              } else if (count > 0) {
                const mean = sum / count;
                add(name, labels, at, { count, sum, min: numberOf(point.min) ?? mean, max: numberOf(point.max) ?? mean, last: mean });
              }
              continue;
            }

            const value = numberOf(point.asDouble) ?? numberOf(point.asInt);
            if (value === undefined) {
              result.unsupported += 1;
              continue;
            }
            if (monotonic && temporality === CUMULATIVE) {
              const increase = this.increase(seriesId, start, value);
              if (increase !== undefined) {
                add(name, labels, at, aggregateOf(increase.sum));
              }
            } else {
              add(name, labels, at, aggregateOf(value));
            }
          }
        }
      }
    }
    result.buckets = [...buckets.values()].sort((a, b) => a.start.toMillis() - b.start.toMillis());
    return result;
  }

  /** Whether a series may be kept, registering it if it is new and there is room. */
  private admit(name: string, key: string): boolean {
    let seen = this.series.get(name);
    if (seen === undefined) {
      if (this.series.size >= this.maxNames) {
        return false;
      }
      seen = new Set();
      this.series.set(name, seen);
    }
    if (seen.has(key)) {
      return true;
    }
    if (seen.size >= this.maxSeriesPerName) {
      return false;
    }
    seen.add(key);
    return true;
  }

  /**
   * The increase of a cumulative series since its previous point, or `undefined` when this point only
   * sets the baseline (first sight, a new start time, or a total that went backwards).
   *
   * @param sum - The point's running total.
   * @param count - The point's running observation count, for a histogram; zero for a sum.
   */
  private increase(seriesId: string, start: string, sum: number, count = 0): { count: number; sum: number } | undefined {
    const previous = this.cumulative.get(seriesId);
    this.cumulative.set(seriesId, { start, count, sum });
    if (previous === undefined || previous.start !== start || sum < previous.sum || count < previous.count) {
      return undefined;
    }
    return { count: count - previous.count, sum: sum - previous.sum };
  }
}
