import { Kysely, RawBuilder, sql } from 'kysely';
import { DateTime, Duration } from 'luxon';
import { mergeAggregates, MetricAggregate } from './metric.aggregate.js';
import { MetricBucket } from './metric.bucket.js';
import { MetricLabels } from './metric.labels.js';
import { MetricResolution } from './metric.resolution.js';

/**
 * Where a {@link MetricsStore} keeps its rows.
 */
export interface MetricsStoreOptions {
  /** The table, schema-qualified if needed: `'metrics.metric_samples'`. */
  table: string;
  /**
   * Fixed column values every row carries and every read filters on, e.g. `{ tenant_key: 'main' }`
   * for an app that keeps several tenants in one table. Each column must be part of the table's
   * primary key. Column names are written as they are in the database.
   */
  scope?: Readonly<Record<string, string>>;
  /** Rows per `insert` statement when upserting. Defaults to 500. */
  batchSize?: number;
}

/**
 * One stored point of a series.
 */
export interface MetricPoint {
  /** The start of the point's minute or hour, in UTC. */
  start: DateTime;
  /** The point's aggregate. */
  aggregate: MetricAggregate;
}

/**
 * One series read back from the store, its points oldest first.
 */
export interface MetricSeries {
  name: string;
  labels: MetricLabels;
  labelsKey: string;
  source: string;
  points: MetricPoint[];
}

/**
 * What to read with {@link MetricsStore.series}.
 */
export interface MetricSeriesQuery {
  /** The metric names to read. An empty list reads nothing. */
  names: readonly string[];
  /** Inclusive start. */
  from: DateTime;
  /** Exclusive end. */
  to: DateTime;
  /** Which rows to read. See `resolutionFor`. */
  resolution: MetricResolution;
  /** Only series whose labels contain all of these pairs. */
  labels?: MetricLabels;
}

/**
 * A metric name the store holds, for building a picker.
 */
export interface MetricName {
  name: string;
  source: string;
  /** Every label key any of its series carries, sorted. */
  labelKeys: string[];
  /** The newest bucket stored for it, at any resolution. */
  lastSeen: DateTime;
}

interface SeriesRow {
  name: string;
  labels: MetricLabels | string;
  labels_key: string;
  source: string;
  bucket: DateTime | Date | string;
  count: number;
  sum: number;
  min: number;
  max: number;
  last: number;
}

interface NameRow {
  name: string;
  source: string;
  last_seen: DateTime | Date | string;
  label_keys: string[] | null;
}

const PRIMARY_KEY = ['resolution', 'name', 'labels_key', 'bucket'] as const;

/**
 * Reads a `timestamptz` however the pool hands it back: a `DateTime` under
 * `@maroonedsoftware/kysely`'s `KyselyPgTypeOverrides`, a `Date` under `pg`'s defaults, or text under
 * a parser that returns the raw value.
 */
const instantOf = (value: DateTime | Date | string): DateTime => {
  if (DateTime.isDateTime(value)) {
    return value.toUTC();
  }
  if (value instanceof Date) {
    return DateTime.fromJSDate(value, { zone: 'utc' });
  }
  return DateTime.fromISO(value.replace(' ', 'T'), { zone: 'utc' });
};

/**
 * Keeps metric buckets in one PostgreSQL table at two resolutions, minutes and hours.
 *
 * The table is the app's own, created by its own migration from the reference DDL in this package's
 * README. The store only reads and writes it.
 *
 * It runs on `db.withoutPlugins()`, so the app's `CamelCasePlugin` (or any other) never rewrites the
 * snake_case columns this class names, and rows come back exactly as PostgreSQL sends them.
 *
 * @example
 * ```typescript
 * const store = new MetricsStore(db, { table: 'app.metric_samples' });
 * await store.upsertMinutes(recorder.drain());
 * await store.rollupHour(DateTime.utc().startOf('hour').minus({ hours: 1 }));
 * ```
 *
 * @typeParam DB - The app's database type. The store never uses it (every statement is raw SQL on the
 *   table it was given), so any `Kysely<DB>` is accepted as it is, with no cast at the call site.
 */
export class MetricsStore<DB = unknown> {
  private readonly db: Kysely<DB>;
  private readonly table: string;
  private readonly scope: [string, string][];
  private readonly batchSize: number;

  /**
   * @param db - Any Kysely instance on the database holding the table.
   * @param options - The table and scope.
   */
  constructor(db: Kysely<DB>, options: MetricsStoreOptions) {
    this.db = db.withoutPlugins();
    this.table = options.table;
    this.scope = Object.entries(options.scope ?? {});
    this.batchSize = options.batchSize ?? 500;
  }

  /**
   * Writes minute buckets, merging each into the row already stored for its series and minute.
   *
   * A minute flushed twice therefore adds up rather than failing or being overwritten, which is what
   * lets a recorder drain its still-open minute. Buckets for the same series and minute in one call
   * are merged first, since PostgreSQL refuses to update one row twice in a statement.
   *
   * @param buckets - What a recorder drained.
   * @param source - Recorded on each row; tells an app's own metrics from received ones. Defaults to `'app'`.
   * @returns How many rows were written.
   */
  async upsertMinutes(buckets: readonly MetricBucket[], source = 'app'): Promise<number> {
    const merged = new Map<string, MetricBucket>();
    for (const bucket of buckets) {
      const id = `${bucket.name}\u0000${bucket.labelsKey}\u0000${bucket.start.toMillis()}`;
      const existing = merged.get(id);
      merged.set(id, existing === undefined ? bucket : { ...existing, aggregate: mergeAggregates(existing.aggregate, bucket.aggregate) });
    }
    const rows = [...merged.values()].map(bucket => ({
      ...Object.fromEntries(this.scope),
      resolution: 'minute',
      bucket: bucket.start.toUTC().toJSDate(),
      name: bucket.name,
      labels: JSON.stringify(bucket.labels),
      labels_key: bucket.labelsKey,
      source,
      ...bucket.aggregate,
    }));

    let written = 0;
    for (let at = 0; at < rows.length; at += this.batchSize) {
      const batch = rows.slice(at, at + this.batchSize);
      const result = await sql`
        insert into ${sql.table(this.table)} as stored (${sql.join(Object.keys(batch[0] ?? {}).map(column => sql.ref(column)))})
        values ${sql.join(batch.map(row => sql`(${sql.join(Object.values(row))})`))}
        on conflict (${this.conflictTarget()}) do update set
          count = ${this.column('count')} + excluded.count,
          sum = ${this.column('sum')} + excluded.sum,
          min = least(${this.column('min')}, excluded.min),
          max = greatest(${this.column('max')}, excluded.max),
          last = excluded.last
      `.execute(this.db);
      written += Number(result.numAffectedRows ?? 0n);
    }
    return written;
  }

  /**
   * Folds one hour of minute rows into hour rows.
   *
   * Idempotent: the hour row is replaced, not added to, so running it twice (a retried job, an
   * overlapping schedule) leaves the same answer. Run it once the hour is complete; run before then
   * and a later run corrects it.
   *
   * @param hourStart - Any instant inside the hour to roll up; it is truncated to the UTC hour.
   * @returns How many hour rows were written.
   */
  async rollupHour(hourStart: DateTime): Promise<number> {
    const from = hourStart.toUTC().startOf('hour');
    const to = from.plus({ hours: 1 });
    const scopeColumns = this.scope.map(([column]) => sql`${sql.ref(column)}, `);
    const scopeValues = this.scope.map(([, value]) => sql`${value}, `);

    const result = await sql`
      insert into ${sql.table(this.table)} (${sql.join(scopeColumns, sql``)}resolution, bucket, name, labels, labels_key, source, count, sum, min, max, last)
      select ${sql.join(scopeValues, sql``)}'hour', ${from.toJSDate()}, name, (array_agg(labels))[1], labels_key, (array_agg(source))[1],
        sum(count), sum(sum), min(min), max(max), (array_agg(last order by bucket desc))[1]
      from ${sql.table(this.table)}
      where ${this.where(sql`resolution = 'minute'`, sql`bucket >= ${from.toJSDate()}`, sql`bucket < ${to.toJSDate()}`)}
      group by name, labels_key
      on conflict (${this.conflictTarget()}) do update set
        labels = excluded.labels, source = excluded.source,
        count = excluded.count, sum = excluded.sum, min = excluded.min, max = excluded.max, last = excluded.last
    `.execute(this.db);
    return Number(result.numAffectedRows ?? 0n);
  }

  /**
   * Deletes rows of one resolution older than `olderThan`.
   *
   * @param resolution - Which rows.
   * @param olderThan - How old a row's bucket must be to go.
   * @param now - The instant ages are measured from. Defaults to now.
   * @returns How many rows were deleted.
   */
  async prune(resolution: MetricResolution, olderThan: Duration, now: DateTime = DateTime.now()): Promise<number> {
    const cutoff = now.minus(olderThan).toUTC().toJSDate();
    const result = await sql`
      delete from ${sql.table(this.table)}
      where ${this.where(sql`resolution = ${resolution}`, sql`bucket < ${cutoff}`)}
    `.execute(this.db);
    return Number(result.numAffectedRows ?? 0n);
  }

  /**
   * Reads series over a range, one entry per name and label set, points oldest first.
   *
   * @param query - The names, range, resolution and label filter.
   */
  async series(query: MetricSeriesQuery): Promise<MetricSeries[]> {
    if (query.names.length === 0) {
      return [];
    }
    const conditions: RawBuilder<unknown>[] = [
      sql`resolution = ${query.resolution}`,
      sql`name in (${sql.join([...query.names])})`,
      sql`bucket >= ${query.from.toUTC().toJSDate()}`,
      sql`bucket < ${query.to.toUTC().toJSDate()}`,
    ];
    if (query.labels !== undefined && Object.keys(query.labels).length > 0) {
      conditions.push(sql`labels @> ${JSON.stringify(query.labels)}::jsonb`);
    }
    const { rows } = await sql<SeriesRow>`
      select name, labels, labels_key, source, bucket, count, sum, min, max, last
      from ${sql.table(this.table)}
      where ${this.where(...conditions)}
      order by name, labels_key, bucket
    `.execute(this.db);

    const series: MetricSeries[] = [];
    let current: MetricSeries | undefined;
    for (const row of rows) {
      if (current === undefined || current.name !== row.name || current.labelsKey !== row.labels_key) {
        const labels = typeof row.labels === 'string' ? (JSON.parse(row.labels) as MetricLabels) : row.labels;
        current = { name: row.name, labels, labelsKey: row.labels_key, source: row.source, points: [] };
        series.push(current);
      }
      current.points.push({
        start: instantOf(row.bucket),
        aggregate: { count: row.count, sum: row.sum, min: row.min, max: row.max, last: row.last },
      });
    }
    return series;
  }

  /**
   * Lists every metric name the store holds, with its source, label keys and newest bucket.
   */
  async names(): Promise<MetricName[]> {
    const { rows } = await sql<NameRow>`
      select name, source, max(bucket) as last_seen, array_agg(distinct key) filter (where key is not null) as label_keys
      from ${sql.table(this.table)} left join lateral jsonb_object_keys(labels) as key on true
      where ${this.where(sql`true`)}
      group by name, source
      order by name, source
    `.execute(this.db);
    return rows.map(row => ({
      name: row.name,
      source: row.source,
      labelKeys: [...(row.label_keys ?? [])].sort(),
      lastSeen: instantOf(row.last_seen),
    }));
  }

  /** A column of the row already stored, inside an upsert's `do update`; the insert aliases the table `stored`. */
  private column(name: string): RawBuilder<unknown> {
    return sql.ref(`stored.${name}`);
  }

  private conflictTarget(): RawBuilder<unknown> {
    return sql.join([...this.scope.map(([column]) => column), ...PRIMARY_KEY].map(column => sql.ref(column)));
  }

  private where(...conditions: RawBuilder<unknown>[]): RawBuilder<unknown> {
    return sql.join([...this.scope.map(([column, value]) => sql`${sql.ref(column)} = ${value}`), ...conditions], sql` and `);
  }
}
