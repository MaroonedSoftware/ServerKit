import { DateTime } from 'luxon';
import { MetricAggregate } from './metric.aggregate.js';
import { MetricLabels } from './metric.labels.js';

/**
 * One series' aggregate over one minute: what a recorder drains and what a store writes.
 */
export interface MetricBucket {
  /** The metric's name, in dot notation: `work.job.ms`. */
  name: string;
  /** The series' labels. */
  labels: MetricLabels;
  /** {@link labelsKey} of `labels`, computed once at observation time. */
  labelsKey: string;
  /** The start of the bucket's minute, in UTC. */
  start: DateTime;
  /** Everything observed for this series in this minute. */
  aggregate: MetricAggregate;
}

/**
 * The start of the minute `at` falls in, in UTC.
 *
 * @param at - Any instant.
 */
export const minuteOf = (at: DateTime): DateTime => at.toUTC().startOf('minute');
