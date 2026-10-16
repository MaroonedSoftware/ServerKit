import { describe, it, expect } from 'vitest';
import { aggregateOf, mergeAggregates } from '../src/metric.aggregate.js';
import { labelsKey } from '../src/metric.labels.js';

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
