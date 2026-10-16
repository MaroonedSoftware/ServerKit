import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { aggregateOf, mergeAggregates } from './metric.aggregate.js';
import { MetricBucket, minuteOf } from './metric.bucket.js';
import { labelsKey, MetricLabels } from './metric.labels.js';

/**
 * Reads a gauge's current value. `undefined` means "no reading this time" and records nothing.
 */
export type GaugeReader = () => number | undefined | Promise<number | undefined>;

/**
 * Called when a gauge's reader throws. The sample is skipped either way.
 */
export type GaugeErrorHandler = (name: string, error: unknown) => void;

/**
 * How a gauge is registered.
 */
export interface GaugeOptions {
  /** Labels for the gauge's series. Defaults to none. */
  labels?: MetricLabels;
  /**
   * The least time between two samples. Defaults to zero: sampled on every
   * {@link MetricsRecorder.sampleGauges} call. Use it for a reading that is expensive (a disk scan)
   * while the sampler runs every minute for the cheap ones.
   */
  every?: Duration;
}

interface RegisteredGauge {
  name: string;
  labels: MetricLabels;
  read: GaugeReader;
  every: Duration;
  sampledAt?: DateTime;
}

/**
 * Accumulates observations into one-minute buckets in memory, and samples registered gauges.
 *
 * Nothing here does I/O. The owner runs a loop that calls {@link sampleGauges} and then
 * {@link drain}, and writes what it drained wherever it keeps metrics (the `/kysely` store, an OTLP
 * bridge, both). Draining hands over the current, still-open minute too: a store merges a later
 * flush of the same minute into the row already written, so nothing waits for a minute to close.
 *
 * Register it as a singleton. One instance per process is the point: every producer observes into
 * the same buffer.
 *
 * @example
 * ```typescript
 * const recorder = container.get(MetricsRecorder);
 * recorder.observe('work.job.ms', 412, { queue: 'catalog.sync' });
 * recorder.gauge('station.listeners', () => audience.count());
 *
 * await recorder.sampleGauges();
 * await store.upsertMinutes(recorder.drain());
 * ```
 */
@Injectable()
export class MetricsRecorder {
  private open = new Map<string, MetricBucket>();
  private readonly gauges = new Map<string, RegisteredGauge>();

  /**
   * Told about a gauge whose reader threw. Unset, such failures are silent: a gauge that cannot be
   * read simply leaves a gap, which is what a chart should show.
   */
  onGaugeError?: GaugeErrorHandler;

  /**
   * Records one observation into the minute `at` falls in.
   *
   * Non-finite values (`NaN`, `Infinity`) are dropped: one of them would poison every aggregate
   * of the bucket it lands in.
   *
   * @param name - The metric's name.
   * @param value - The observed value.
   * @param labels - The series' labels.
   * @param at - When it was observed. Defaults to now.
   */
  observe(name: string, value: number, labels: MetricLabels = {}, at: DateTime = DateTime.now()): void {
    if (!Number.isFinite(value)) {
      return;
    }
    const start = minuteOf(at);
    const key = labelsKey(labels);
    const id = `${name}\u0000${key}\u0000${start.toMillis()}`;
    const existing = this.open.get(id);
    if (existing === undefined) {
      this.open.set(id, { name, labels, labelsKey: key, start, aggregate: aggregateOf(value) });
    } else {
      existing.aggregate = mergeAggregates(existing.aggregate, aggregateOf(value));
    }
  }

  /**
   * Registers a gauge to be sampled by {@link sampleGauges}.
   *
   * Registering the same name and labels again replaces the earlier reader.
   *
   * @param name - The metric's name.
   * @param read - Returns the current value.
   * @param options - Labels and sampling cadence.
   * @returns A function that unregisters this gauge.
   */
  gauge(name: string, read: GaugeReader, options: GaugeOptions = {}): () => void {
    const labels = options.labels ?? {};
    const id = `${name}\u0000${labelsKey(labels)}`;
    const registered: RegisteredGauge = { name, labels, read, every: options.every ?? Duration.fromMillis(0) };
    this.gauges.set(id, registered);
    return () => {
      if (this.gauges.get(id) === registered) {
        this.gauges.delete(id);
      }
    };
  }

  /**
   * Reads every gauge that is due and observes its value at `now`.
   *
   * Readers run concurrently, so one slow gauge does not delay the others. A reader that throws
   * or answers `undefined` records nothing; it is still marked sampled, so a failing reader is
   * retried at its own cadence rather than on every call.
   *
   * @param now - The sampling instant. Defaults to now.
   */
  async sampleGauges(now: DateTime = DateTime.now()): Promise<void> {
    const due = [...this.gauges.values()].filter(gauge => gauge.sampledAt === undefined || gauge.sampledAt.plus(gauge.every) <= now);
    await Promise.all(
      due.map(async gauge => {
        gauge.sampledAt = now;
        try {
          const value = await gauge.read();
          if (value !== undefined) {
            this.observe(gauge.name, value, gauge.labels, now);
          }
        } catch (error) {
          this.onGaugeError?.(gauge.name, error);
        }
      }),
    );
  }

  /**
   * Hands over every bucket recorded since the last drain and empties the buffer.
   *
   * @returns The buckets, oldest minute first.
   */
  drain(): MetricBucket[] {
    const buckets = [...this.open.values()];
    this.open = new Map();
    return buckets.sort((a, b) => a.start.toMillis() - b.start.toMillis());
  }

  /** How many buckets are waiting to be drained. */
  get pending(): number {
    return this.open.size;
  }
}
