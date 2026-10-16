import { describe, it, expect } from 'vitest';
import {
  CamelCasePlugin,
  CompiledQuery,
  DatabaseConnection,
  Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  QueryResult,
} from 'kysely';
import { DateTime, Duration } from 'luxon';
import { aggregateOf } from '../src/metric.aggregate.js';
import { MetricBucket } from '../src/metric.bucket.js';
import { labelsKey, MetricLabels } from '../src/metric.labels.js';
import { MetricsStore } from '../src/metrics.store.js';

/** A Kysely on a driver that records every query and answers each with the next queued result. */
const fakeDb = (results: Partial<QueryResult<unknown>>[] = []) => {
  const queries: CompiledQuery[] = [];
  const connection: DatabaseConnection = {
    executeQuery: async <R>(query: CompiledQuery) => {
      queries.push(query);
      return { rows: [], ...results.shift() } as QueryResult<R>;
    },
    streamQuery: () => {
      throw new Error('not used');
    },
  };
  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {},
  };
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: k => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins: [new CamelCasePlugin()],
  });
  return { db, queries };
};

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const at = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });
const bucket = (name: string, value: number, start: string, labels: MetricLabels = {}): MetricBucket => ({
  name,
  labels,
  labelsKey: labelsKey(labels),
  start: at(start),
  aggregate: aggregateOf(value),
});

describe('MetricsStore', () => {
  describe('upsertMinutes', () => {
    it('inserts minute rows and merges a conflicting row into the stored one', async () => {
      const { db, queries } = fakeDb([{ numAffectedRows: 1n }]);
      const store = new MetricsStore(db, { table: 'app.metric_samples', scope: { tenant_key: 'main' } });

      const written = await store.upsertMinutes([bucket('work.job.ms', 40, '2026-10-16T12:00:00Z', { queue: 'a' })]);

      expect(written).toBe(1);
      const sql = squash(queries[0]?.sql ?? '');
      expect(sql).toContain(
        'insert into "app"."metric_samples" as stored ("tenant_key", "resolution", "bucket", "name", "labels", "labels_key", "source", "count", "sum", "min", "max", "last")',
      );
      expect(sql).toContain('on conflict ("tenant_key", "resolution", "name", "labels_key", "bucket") do update set');
      expect(sql).toContain('count = "stored"."count" + excluded.count');
      expect(sql).toContain('min = least("stored"."min", excluded.min)');
      expect(sql).toContain('last = excluded.last');
      expect(queries[0]?.parameters).toEqual([
        'main',
        'minute',
        at('2026-10-16T12:00:00Z').toJSDate(),
        'work.job.ms',
        '{"queue":"a"}',
        '{"queue":"a"}',
        'app',
        1,
        40,
        40,
        40,
        40,
      ]);
    });

    it('is not rewritten by the caller’s CamelCasePlugin', async () => {
      const { db, queries } = fakeDb();
      await new MetricsStore(db, { table: 'metric_samples' }).upsertMinutes([bucket('a', 1, '2026-10-16T12:00:00Z')]);

      expect(queries[0]?.sql).toContain('"labels_key"');
    });

    it('merges buckets for one series and minute before writing, since Postgres refuses to update a row twice', async () => {
      const { db, queries } = fakeDb();
      await new MetricsStore(db, { table: 'metric_samples' }).upsertMinutes([
        bucket('a', 1, '2026-10-16T12:00:00Z'),
        bucket('a', 5, '2026-10-16T12:00:00Z'),
      ]);

      expect(queries[0]?.parameters.slice(-5)).toEqual([2, 6, 1, 5, 5]);
    });

    it('writes in batches and does nothing for no buckets', async () => {
      const { db, queries } = fakeDb();
      const store = new MetricsStore(db, { table: 'metric_samples', batchSize: 2 });

      await store.upsertMinutes([]);
      expect(queries).toHaveLength(0);

      await store.upsertMinutes(['a', 'b', 'c'].map(name => bucket(name, 1, '2026-10-16T12:00:00Z')));
      expect(queries).toHaveLength(2);
    });

    it('records the given source', async () => {
      const { db, queries } = fakeDb();
      await new MetricsStore(db, { table: 'metric_samples' }).upsertMinutes([bucket('a', 1, '2026-10-16T12:00:00Z')], 'otlp');

      expect(queries[0]?.parameters).toContain('otlp');
    });
  });

  describe('rollupHour', () => {
    it('replaces the hour row from that hour of minutes, so a second run changes nothing', async () => {
      const { db, queries } = fakeDb([{ numAffectedRows: 3n }]);
      const store = new MetricsStore(db, { table: 'metric_samples', scope: { tenant_key: 'main' } });

      const written = await store.rollupHour(at('2026-10-16T12:34:56Z'));

      expect(written).toBe(3);
      const sql = squash(queries[0]?.sql ?? '');
      expect(sql).toContain("select $1, 'hour', $2, name");
      expect(sql).toContain('(array_agg(last order by bucket desc))[1]');
      expect(sql).toContain('where "tenant_key" = $3 and resolution = \'minute\' and bucket >= $4 and bucket < $5');
      expect(sql).toContain('count = excluded.count');
      expect(sql).not.toContain('+ excluded');
      expect(queries[0]?.parameters).toEqual([
        'main',
        at('2026-10-16T12:00:00Z').toJSDate(),
        'main',
        at('2026-10-16T12:00:00Z').toJSDate(),
        at('2026-10-16T13:00:00Z').toJSDate(),
      ]);
    });
  });

  describe('prune', () => {
    it('deletes rows of one resolution older than the window', async () => {
      const { db, queries } = fakeDb([{ numAffectedRows: 9n }]);
      const store = new MetricsStore(db, { table: 'metric_samples' });

      const removed = await store.prune('minute', Duration.fromObject({ days: 7 }), at('2026-10-16T00:00:00Z'));

      expect(removed).toBe(9);
      expect(squash(queries[0]?.sql ?? '')).toBe('delete from "metric_samples" where resolution = $1 and bucket < $2');
      expect(queries[0]?.parameters).toEqual(['minute', at('2026-10-09T00:00:00Z').toJSDate()]);
    });
  });

  describe('series', () => {
    it('reads nothing for no names', async () => {
      const { db, queries } = fakeDb();
      const read = await new MetricsStore(db, { table: 'metric_samples' }).series({
        names: [],
        from: at('2026-10-16T00:00:00Z'),
        to: at('2026-10-17T00:00:00Z'),
        resolution: 'minute',
      });

      expect(read).toEqual([]);
      expect(queries).toHaveLength(0);
    });

    it('groups rows into series and filters by contained labels', async () => {
      const rows = [
        {
          name: 'a',
          labels: { q: '1' },
          labels_key: '{"q":"1"}',
          source: 'app',
          bucket: new Date('2026-10-16T12:00:00Z'),
          count: 1,
          sum: 2,
          min: 2,
          max: 2,
          last: 2,
        },
        {
          name: 'a',
          labels: { q: '1' },
          labels_key: '{"q":"1"}',
          source: 'app',
          bucket: '2026-10-16 12:01:00+00',
          count: 1,
          sum: 3,
          min: 3,
          max: 3,
          last: 3,
        },
        {
          name: 'a',
          labels: '{"q":"2"}',
          labels_key: '{"q":"2"}',
          source: 'app',
          bucket: new Date('2026-10-16T12:00:00Z'),
          count: 1,
          sum: 4,
          min: 4,
          max: 4,
          last: 4,
        },
      ];
      const { db, queries } = fakeDb([{ rows }]);

      const read = await new MetricsStore(db, { table: 'metric_samples' }).series({
        names: ['a', 'b'],
        from: at('2026-10-16T00:00:00Z'),
        to: at('2026-10-17T00:00:00Z'),
        resolution: 'minute',
        labels: { host: 'x' },
      });

      expect(squash(queries[0]?.sql ?? '')).toContain('name in ($2, $3)');
      expect(queries[0]?.sql).toContain('labels @> $6::jsonb');
      expect(read.map(s => [s.labels, s.points.length])).toEqual([
        [{ q: '1' }, 2],
        [{ q: '2' }, 1],
      ]);
      expect(read[0]?.points[1]?.start.toISO()).toBe('2026-10-16T12:01:00.000Z');
      expect(read[0]?.points[1]?.aggregate.sum).toBe(3);
    });

    it('reads a bucket the pool already parsed into a DateTime, as KyselyPgTypeOverrides does', async () => {
      const bucket = DateTime.fromISO('2026-10-16T08:00:00', { zone: 'America/New_York' });
      const rows = [{ name: 'a', labels: {}, labels_key: '{}', source: 'app', bucket, count: 1, sum: 1, min: 1, max: 1, last: 1 }];
      const { db } = fakeDb([{ rows }]);

      const [series] = await new MetricsStore(db, { table: 'metric_samples' }).series({
        names: ['a'],
        from: at('2026-10-16T00:00:00Z'),
        to: at('2026-10-17T00:00:00Z'),
        resolution: 'minute',
      });

      expect(series?.points[0]?.start.toISO()).toBe('2026-10-16T12:00:00.000Z');
    });
  });

  describe('names', () => {
    it('lists names with their sorted label keys and newest bucket', async () => {
      const rows = [
        { name: 'a', source: 'app', last_seen: new Date('2026-10-16T12:00:00Z'), label_keys: ['z', 'q'] },
        { name: 'b', source: 'otlp', last_seen: DateTime.fromISO('2026-10-16T12:00:00Z'), label_keys: null },
      ];
      const { db } = fakeDb([{ rows }]);

      const names = await new MetricsStore(db, { table: 'metric_samples' }).names();

      expect(names.map(n => [n.name, n.source, n.labelKeys])).toEqual([
        ['a', 'app', ['q', 'z']],
        ['b', 'otlp', []],
      ]);
      expect(names[1]?.lastSeen.toISO()).toBe('2026-10-16T12:00:00.000Z');
    });
  });
});
