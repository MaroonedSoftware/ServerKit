/**
 * The labels that tell one series of a metric from another, e.g. `{ queue: 'catalog.sync' }`.
 *
 * Values are strings only. A number used as a label is almost always a cardinality mistake waiting
 * to happen, and making the caller write `String(x)` is a moment to notice it.
 */
export type MetricLabels = Readonly<Record<string, string>>;

/**
 * A canonical string for a label set: JSON with keys sorted.
 *
 * Two label sets with the same pairs in a different order produce the same key, so the key can sit
 * in a primary key where the `jsonb` labels themselves cannot be compared cheaply.
 *
 * @param labels - The label set.
 * @returns `'{}'` for no labels, otherwise sorted JSON.
 */
export const labelsKey = (labels: MetricLabels): string => {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(labels).sort()) {
    const value = labels[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  return JSON.stringify(sorted);
};
