import { describe, it, expect } from 'vitest';
import { aggregateOf, bucketedAggregateOf, DURATION_BOUNDS_MS, mergeAggregates, validBounds } from '../src/metric.aggregate.js';
import { labelsKey } from '../src/metric.labels.js';

describe('bucket counts', () => {
  const bounds = [10, 100];

  it('counts a value into the first bucket whose bound it does not exceed, or the overflow', () => {
    expect(bucketedAggregateOf(5, bounds).buckets?.counts).toEqual([1, 0, 0]);
    expect(bucketedAggregateOf(10, bounds).buckets?.counts).toEqual([1, 0, 0]);
    expect(bucketedAggregateOf(11, bounds).buckets?.counts).toEqual([0, 1, 0]);
    expect(bucketedAggregateOf(1_000, bounds).buckets?.counts).toEqual([0, 0, 1]);
    expect(aggregateOf(5)).not.toHaveProperty('buckets');
  });

  it('adds counts when both sides share bounds, and drops them otherwise', () => {
    const merged = mergeAggregates(
      mergeAggregates(bucketedAggregateOf(5, bounds), bucketedAggregateOf(50, bounds)),
      bucketedAggregateOf(500, bounds),
    );
    expect(merged.buckets).toEqual({ bounds, counts: [1, 1, 1] });
    expect(merged.buckets?.counts.reduce((a, b) => a + b)).toBe(merged.count);

    expect(mergeAggregates(bucketedAggregateOf(5, bounds), bucketedAggregateOf(5, [1, 2]))).not.toHaveProperty('buckets');
    expect(mergeAggregates(bucketedAggregateOf(5, bounds), aggregateOf(5))).not.toHaveProperty('buckets');
  });

  it('accepts only finite, strictly ascending bounds', () => {
    expect(validBounds(DURATION_BOUNDS_MS)).toBe(true);
    expect(validBounds([])).toBe(false);
    expect(validBounds([1, 1])).toBe(false);
    expect(validBounds([2, 1])).toBe(false);
    expect(validBounds([1, Infinity])).toBe(false);
  });
});

describe('mergeAggregates', () => {
  it('sums counts and totals, keeps the extremes, and takes the later last', () => {
    expect(mergeAggregates(aggregateOf(5), aggregateOf(2))).toEqual({ count: 2, sum: 7, min: 2, max: 5, last: 2 });
  });

  it('is associative, so minutes can be folded into an hour in any grouping', () => {
    const [a, b, c] = [aggregateOf(1), aggregateOf(9), aggregateOf(4)];
    expect(mergeAggregates(mergeAggregates(a, b), c)).toEqual(mergeAggregates(a, mergeAggregates(b, c)));
  });
});

describe('labelsKey', () => {
  it('is sorted JSON, and {} for no labels', () => {
    expect(labelsKey({ b: '2', a: '1' })).toBe('{"a":"1","b":"2"}');
    expect(labelsKey({})).toBe('{}');
  });
});
