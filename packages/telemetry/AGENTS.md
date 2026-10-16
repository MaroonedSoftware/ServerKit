# AGENTS.md — @maroonedsoftware/telemetry

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Collects application metrics into one-minute buckets in memory (`MetricsRecorder`), so an app can keep
its own numbers over time and chart them. Not an OpenTelemetry SDK replacement: it holds aggregates, not
raw observations, and has no percentiles. Reach for the OTel SDK directly when you only need to ship
metrics to a collector and never read them back.

## Install

```bash
pnpm add @maroonedsoftware/telemetry injectkit reflect-metadata
```

Required peers: none beyond `injectkit`'s own `reflect-metadata`.
Optional peers: `kysely` — unlocks the `./kysely` subpath (`MetricsStore`).

## Position in the graph

- **Depends on:** nothing internal
- **Depended on by:** nothing internal
- **Subpath exports:** `./kysely` — `MetricsStore`, the PostgreSQL store; a subpath so the root entry stays free of `kysely`

## API surface

| Export                    | Kind      | Shape                                                                                                                            | Notes                                    |
| ------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `MetricsRecorder`         | class     | `observe(name, value, labels?, at?)`, `gauge(name, read, options?)`, `sampleGauges(now?)`, `drain()`, `pending`, `onGaugeError?` | `@Injectable()`; register as a singleton |
| `GaugeReader`             | type      | `() => number \| undefined \| Promise<number \| undefined>`                                                                      | `undefined` records nothing              |
| `GaugeOptions`            | interface | `{ labels?: MetricLabels; every?: Duration }`                                                                                    | `every` defaults to zero (every pass)    |
| `GaugeErrorHandler`       | type      | `(name: string, error: unknown) => void`                                                                                         |                                          |
| `MetricAggregate`         | interface | `{ count, sum, min, max, last }`                                                                                                 |                                          |
| `aggregateOf`             | function  | `(value: number) => MetricAggregate`                                                                                             |                                          |
| `mergeAggregates`         | function  | `(previous, next) => MetricAggregate`                                                                                            | associative; `last` is taken from `next` |
| `MetricBucket`            | interface | `{ name, labels, labelsKey, start: DateTime, aggregate }`                                                                        | `start` is the UTC minute                |
| `minuteOf`                | function  | `(at: DateTime) => DateTime`                                                                                                     | UTC start of minute                      |
| `MetricLabels`            | type      | `Readonly<Record<string, string>>`                                                                                               | string values only                       |
| `labelsKey`               | function  | `(labels: MetricLabels) => string`                                                                                               | sorted JSON; `'{}'` for none             |
| `MetricResolution`        | type      | `'minute' \| 'hour'`                                                                                                             |                                          |
| `resolutionFor`           | function  | `(from, to, limit?) => MetricResolution`                                                                                         | minutes up to `limit` (48h), else hours  |
| `MINUTE_RESOLUTION_LIMIT` | const     | `Duration` (48 hours)                                                                                                            |                                          |

### `./kysely`

| Export                | Kind      | Shape                                                                                                                                                    | Notes                                                                         |
| --------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `MetricsStore`        | class     | `new MetricsStore(db, options)`; `upsertMinutes(buckets, source?)`, `rollupHour(hour)`, `prune(resolution, olderThan, now?)`, `series(query)`, `names()` | runs on `db.withoutPlugins()`; not `@Injectable()`, construct it in a factory |
| `MetricsStoreOptions` | interface | `{ table: string; scope?: Record<string, string>; batchSize?: number }`                                                                                  | `scope` columns must be in the primary key                                    |
| `MetricSeriesQuery`   | interface | `{ names, from, to, resolution, labels? }`                                                                                                               | `to` is exclusive; `labels` matches with `@>`                                 |
| `MetricSeries`        | interface | `{ name, labels, labelsKey, source, points: MetricPoint[] }`                                                                                             | points oldest first                                                           |
| `MetricPoint`         | interface | `{ start: DateTime; aggregate: MetricAggregate }`                                                                                                        |                                                                               |
| `MetricName`          | interface | `{ name, source, labelKeys: string[], lastSeen: DateTime }`                                                                                              |                                                                               |

## Canonical usage

```typescript
import { MetricsRecorder } from '@maroonedsoftware/telemetry';

registry.register(MetricsRecorder).useClass(MetricsRecorder).asSingleton();

const recorder = container.get(MetricsRecorder);
recorder.observe('work.job.ms', 412, { queue: 'catalog.sync' });
recorder.gauge('station.listeners', () => audience.count());

// your loop, once a minute
await recorder.sampleGauges();
await write(recorder.drain());
```

With the store, in the app's own loop and jobs:

```typescript
import { MetricsStore } from '@maroonedsoftware/telemetry/kysely';

const store = new MetricsStore(db, { table: 'app.metric_samples' });
await store.upsertMinutes(recorder.drain()); // every minute
await store.rollupHour(DateTime.utc().minus({ hours: 1 })); // hourly job
await store.prune('minute', Duration.fromObject({ days: 7 })); // nightly job
```

## Rules for generated code

- Register `MetricsRecorder` as a singleton. A scoped or transient recorder splits observations across
  instances and the loop drains only one of them.
- Name metrics in dot notation (`work.job.ms`), with the unit as the last segment when there is one.
- Keep label values from a small, known set (a queue name, a plugin id). Never put an id, a user, or
  free text in a label: every distinct label set is a row per minute.
- Drain on shutdown too, after producers have stopped, or the last partial minute is lost.
- Create the table from the reference DDL in the README, in the app's own migration. Column names are
  fixed; add `scope` columns to the primary key, first.
- Roll an hour up only once it is complete. Rolling up early is not wrong (the next run replaces the row)
  but the hour row lags until then.

## Gotchas

- `drain()` includes the still-open minute. A store must merge (upsert) rather than insert, or a
  minute flushed twice is double-counted or rejected.
- `observe()` silently drops `NaN` and `Infinity`.
- `MetricsStore` ignores the app's Kysely plugins. Rows from `series()` are mapped by the store, never
  read raw, so a `CamelCasePlugin` cannot rename its columns underneath it.
- A gauge whose reader throws is marked sampled anyway, so it is retried at its `every` cadence, not on
  the next pass.

## Working inside this package

`src/` holds one concern per file (`metric.aggregate.ts`, `metric.labels.ts`, `metric.bucket.ts`,
`metric.resolution.ts`, `metrics.recorder.ts`) behind the `src/index.ts` barrel, and `metrics.store.ts` behind the
`src/kysely.ts` subpath entry; tests mirror them in `tests/`. Keep the root
entry free of I/O and of external SDKs. A new subpath needs an `exports` entry, a tsup entry in
`build`, and its SDK as an optional peer. Every user-visible change needs a changeset.
