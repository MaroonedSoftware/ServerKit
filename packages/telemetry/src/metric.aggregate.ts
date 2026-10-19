/**
 * Five numbers that summarise every observation of one series inside one bucket.
 *
 * One shape covers all three kinds of metric, so a store needs a single row type:
 * - a **gauge** reads `last` (or `sum / count` for the bucket's mean),
 * - a **counter** reads `sum`,
 * - a **duration** reads `sum / count` for the mean and `max` for the worst.
 *
 * Percentiles need a distribution: a metric given bucket bounds (`MetricsRecorder.bucketBounds`)
 * also counts its observations into {@link MetricBuckets}, which an OTLP histogram sends. Without
 * them, the mean beside the max is enough to see that something got slow.
 */
export interface MetricAggregate {
  /** How many observations were folded in. */
  count: number;
  /** Their total. */
  sum: number;
  /** The smallest observation. */
  min: number;
  /** The largest observation. */
  max: number;
  /** The most recent observation. */
  last: number;
  /** How many observations fell into each bucket, for a metric given bounds. */
  buckets?: MetricBuckets;
}

/**
 * Observations counted into fixed buckets, as an OTLP explicit-bucket histogram: bucket `i` holds
 * values in `(bounds[i - 1], bounds[i]]`, and the last bucket everything above the last bound, so
 * there is one more count than bounds.
 */
export interface MetricBuckets {
  /** Ascending, finite upper bounds. */
  bounds: readonly number[];
  /** `bounds.length + 1` counts. */
  counts: number[];
}

/** Bucket bounds for request and job durations in milliseconds, from 5 ms to 10 minutes. */
export const DURATION_BOUNDS_MS: readonly number[] = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000,
];

/** Whether `bounds` can bucket observations: at least one finite bound, strictly ascending. */
export const validBounds = (bounds: readonly number[]): boolean =>
  bounds.length > 0 && bounds.every((bound, i) => Number.isFinite(bound) && (i === 0 || bound > (bounds[i - 1] as number)));

/**
 * The aggregate of a single observation.
 *
 * @param value - The observed value. The caller is expected to have rejected non-finite values.
 */
export const aggregateOf = (value: number): MetricAggregate => ({ count: 1, sum: value, min: value, max: value, last: value });

/**
 * The aggregate of a single observation, also counted into buckets.
 *
 * @param value - The observed value. The caller is expected to have rejected non-finite values.
 * @param bounds - Bucket bounds, already checked with {@link validBounds}.
 */
export const bucketedAggregateOf = (value: number, bounds: readonly number[]): MetricAggregate => {
  const counts = new Array<number>(bounds.length + 1).fill(0);
  const index = bounds.findIndex(bound => value <= bound);
  counts[index === -1 ? bounds.length : index] = 1;
  return { ...aggregateOf(value), buckets: { bounds, counts } };
};

const sameBounds = (a: readonly number[], b: readonly number[]): boolean =>
  a === b || (a.length === b.length && a.every((bound, i) => bound === b[i]));

/**
 * Folds `next` into `previous`.
 *
 * Associative, so buckets can be merged in any grouping (a flush into a stored row, minutes into an
 * hour). Not commutative in `last`: `next` is taken to be the later of the two. Buckets are kept
 * only when both sides have them with the same bounds; otherwise the counts could not add up to
 * `count`, so the merge has none.
 *
 * @param previous - The earlier aggregate.
 * @param next - The later aggregate.
 * @returns A new aggregate; neither input is modified.
 */
export const mergeAggregates = (previous: MetricAggregate, next: MetricAggregate): MetricAggregate => {
  const merged: MetricAggregate = {
    count: previous.count + next.count,
    sum: previous.sum + next.sum,
    min: Math.min(previous.min, next.min),
    max: Math.max(previous.max, next.max),
    last: next.last,
  };
  if (previous.buckets && next.buckets && sameBounds(previous.buckets.bounds, next.buckets.bounds)) {
    const counts = next.buckets.counts;
    merged.buckets = { bounds: next.buckets.bounds, counts: previous.buckets.counts.map((count, i) => count + (counts[i] ?? 0)) };
  }
  return merged;
};
