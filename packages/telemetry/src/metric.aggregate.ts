/**
 * Five numbers that summarise every observation of one series inside one bucket.
 *
 * One shape covers all three kinds of metric, so a store needs a single row type:
 * - a **gauge** reads `last` (or `sum / count` for the bucket's mean),
 * - a **counter** reads `sum`,
 * - a **duration** reads `sum / count` for the mean and `max` for the worst.
 *
 * There are no percentiles. They need a histogram or a sketch per bucket, and the
 * mean beside the max is enough to see that something got slow.
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
}

/**
 * The aggregate of a single observation.
 *
 * @param value - The observed value. The caller is expected to have rejected non-finite values.
 */
export const aggregateOf = (value: number): MetricAggregate => ({ count: 1, sum: value, min: value, max: value, last: value });

/**
 * Folds `next` into `previous`.
 *
 * Associative, so buckets can be merged in any grouping (a flush into a stored row, minutes into an
 * hour). Not commutative in `last`: `next` is taken to be the later of the two.
 *
 * @param previous - The earlier aggregate.
 * @param next - The later aggregate.
 * @returns A new aggregate; neither input is modified.
 */
export const mergeAggregates = (previous: MetricAggregate, next: MetricAggregate): MetricAggregate => ({
  count: previous.count + next.count,
  sum: previous.sum + next.sum,
  min: Math.min(previous.min, next.min),
  max: Math.max(previous.max, next.max),
  last: next.last,
});
