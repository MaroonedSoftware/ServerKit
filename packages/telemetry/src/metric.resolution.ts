import { DateTime, Duration } from 'luxon';

/**
 * The two widths a stored metric row can have: raw minutes, and the hours they are rolled up into.
 */
export type MetricResolution = 'minute' | 'hour';

/**
 * The widest range still read at minute resolution by {@link resolutionFor}: two days is 2,880
 * points per series, about as many as a chart can draw usefully.
 */
export const MINUTE_RESOLUTION_LIMIT = Duration.fromObject({ hours: 48 });

/**
 * The resolution to read a range at: minutes for a range up to `limit`, hours beyond it.
 *
 * @param from - The start of the range.
 * @param to - The end of the range.
 * @param limit - The widest range read in minutes. Defaults to {@link MINUTE_RESOLUTION_LIMIT}.
 */
export const resolutionFor = (from: DateTime, to: DateTime, limit: Duration = MINUTE_RESOLUTION_LIMIT): MetricResolution =>
  to.diff(from) <= limit ? 'minute' : 'hour';
