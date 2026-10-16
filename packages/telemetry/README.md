# @maroonedsoftware/telemetry

Minute-bucket metrics for ServerKit. Producers observe numbers into an in-process recorder; a loop you own drains it once a minute and writes what it drained wherever you keep metrics.

## Features

- **One shape for every metric**: each series' minute is five numbers (`count`, `sum`, `min`, `max`, `last`), which read as a gauge, a counter or a duration
- **Gauge registry**: register a reader once, sample it on every pass or at its own cadence
- **Merge-friendly**: aggregates are associative, so a later flush of the same minute merges into the row already stored, and minutes fold into hours
- **No I/O in the recorder**: storage and export are separate, so a dead database or collector never blocks a producer
- **A PostgreSQL store** (`/kysely`): merging upserts, idempotent hourly rollups, pruning, range reads
- **Zero internal dependencies**: [injectkit](https://www.npmjs.com/package/injectkit) and [luxon](https://moment.github.io/luxon/) only

## Installation

```bash
pnpm add @maroonedsoftware/telemetry injectkit reflect-metadata
```

## Quick start

```typescript
import { MetricsRecorder } from '@maroonedsoftware/telemetry';
import { Duration } from 'luxon';

const recorder = new MetricsRecorder(); // register as a singleton in your container

// Anywhere work happens:
recorder.observe('work.job.ms', 412, { queue: 'catalog.sync' });

// Once, where a reading lives:
recorder.gauge('disk.free.bytes', () => disk.free(), { every: Duration.fromObject({ minutes: 15 }) });

// In a loop you own, once a minute:
await recorder.sampleGauges();
const buckets = recorder.drain();
```

## Storing metrics in PostgreSQL

`@maroonedsoftware/telemetry/kysely` needs `kysely` installed. The table belongs to your app; create it in your own migration:

```sql
create table app.metric_samples (
  resolution  text             not null check (resolution in ('minute', 'hour')),
  bucket      timestamptz      not null,
  name        text             not null,
  labels      jsonb            not null default '{}',
  labels_key  text             not null,
  source      text             not null default 'app',
  count       double precision not null,
  sum         double precision not null,
  min         double precision not null,
  max         double precision not null,
  last        double precision not null,
  primary key (resolution, name, labels_key, bucket)
);
create index metric_samples_bucket on app.metric_samples (resolution, bucket);
```

To keep several tenants in one table, add a column per tenant key to the front of the primary key and the index, and pass it as `scope`.

```typescript
import { MetricsStore } from '@maroonedsoftware/telemetry/kysely';
import { resolutionFor } from '@maroonedsoftware/telemetry';

const store = new MetricsStore(db, { table: 'app.metric_samples' });

await store.upsertMinutes(recorder.drain()); // a later flush of the same minute merges in
await store.rollupHour(DateTime.utc().minus({ hours: 1 })); // idempotent: replaces the hour row
await store.prune('minute', Duration.fromObject({ days: 7 }));
await store.prune('hour', Duration.fromObject({ days: 400 }));

const series = await store.series({ names: ['work.job.ms'], from, to, resolution: resolutionFor(from, to) });
```

## Reading an aggregate

| Kind     | Read                                        |
| -------- | ------------------------------------------- |
| Gauge    | `last`, or `sum / count` for the mean       |
| Counter  | `sum`                                       |
| Duration | `sum / count` for the mean, `max` for worst |

There are no percentiles: those need a histogram or sketch per bucket.

## License

MIT
