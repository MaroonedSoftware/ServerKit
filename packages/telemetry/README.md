# @maroonedsoftware/telemetry

Minute-bucket metrics for ServerKit. Producers observe numbers into an in-process recorder; a loop you own drains it once a minute and writes what it drained wherever you keep metrics.

## Features

- **One shape for every metric**: each series' minute is five numbers (`count`, `sum`, `min`, `max`, `last`), which read as a gauge, a counter or a duration
- **Gauge registry**: register a reader once, sample it on every pass or at its own cadence
- **Merge-friendly**: aggregates are associative, so a later flush of the same minute merges into the row already stored, and minutes fold into hours
- **No I/O in the recorder**: storage and export are separate, so a dead database or collector never blocks a producer
- **A PostgreSQL store** (`/kysely`): merging upserts, idempotent hourly rollups, pruning, range reads
- **OpenTelemetry bridges** (`/otlp`): send the same buckets, and finished spans, to any OTLP exporter, as delta or cumulative series
- **Google Cloud** (`/google`): auth headers and a resource for exporting straight to Google's Telemetry API
- **An OTLP/JSON receiver**: read other services' metric exports into the same buckets, with cumulative-to-delta and a cardinality cap
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

## Exporting over OTLP

`@maroonedsoftware/telemetry/otlp` needs `@opentelemetry/api`, `/core`, `/resources`, `/sdk-metrics` and `/sdk-trace`, plus whichever exporter you send with.

```typescript
import { OtlpMetricsBridge, OtlpSpanBridge } from '@maroonedsoftware/telemetry/otlp';

const metrics = new OtlpMetricsBridge({
  exporter: new OTLPMetricExporter({ url: 'http://collector:4318/v1/metrics' }),
  kindOf: name => (name.endsWith('.ms') ? 'histogram' : name.endsWith('.count') ? 'counter' : 'gauge'),
});
await metrics.export(buckets);

const spans = new OtlpSpanBridge({ exporter: new OTLPTraceExporter({ url: 'http://collector:4318/v1/traces' }) });
await spans.export([{ traceId: 'job-42', spanId: 'job-42/run', name: 'job.run', start, end, ok: true }]);
```

By default metrics go out with delta temporality: each bucket is one point spanning its minute. Drain them with `recorder.drainClosed()`, which holds the open minute back until it has ended, so no minute goes out twice. Pass `temporality: 'cumulative'` to send each series' running total instead, from its first minute to the export time: what Prometheus and Google Cloud's Managed Service for Prometheus keep, with no `deltatocumulative` step in a collector. Cumulative mode tolerates a minute exported in parts, and a failed export is caught up by the next one. Spans keep the times you recorded, and your own ids are hashed into OTLP form so the same id always lands in the same trace.

## Exporting to Google Cloud

`@maroonedsoftware/telemetry/google` needs `google-auth-library` and `@opentelemetry/resources`. It sends OTLP straight to Google's Telemetry API (`https://telemetry.googleapis.com`), which feeds Cloud Trace and Cloud Monitoring, with no collector in between.

```typescript
import { googleCloudResource, googleMetricsUrl, googleOtlpHeaders, googleTracesUrl } from '@maroonedsoftware/telemetry/google';

const resource = googleCloudResource(); // one per process, shared by every exporter
const headers = googleOtlpHeaders(); // Application Default Credentials, fresh for every export

const metrics = new OtlpMetricsBridge({
  exporter: new OTLPMetricExporter({ url: googleMetricsUrl, headers }),
  resource,
  temporality: 'cumulative',
  kindOf,
});
const traces = new OTLPTraceExporter({ url: googleTracesUrl, headers });
```

- `googleCloudResource()` names the project (`gcp.project_id`, which Google requires), the region (`cloud.region`, also required, and never `global`) and a `service.instance.id` unique to the process, from the environment (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_REGION`, `OTEL_SERVICE_NAME`, Cloud Run's `K_SERVICE`) and the metadata server. Off Google Cloud the lookups fail fast, so set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_REGION` there; the process gets a random instance id.
- Give histograms bucket bounds (`recorder.bucketBounds`): Google refuses a histogram without any.
- Use `temporality: 'cumulative'`: Google stores metrics the way Managed Service for Prometheus does, where a delta sum is a Cloud Monitoring delta metric that PromQL cannot `rate()`.
- The identity the process runs as needs `roles/telemetry.writer` on the project and `roles/serviceusage.serviceUsageConsumer` on the quota project. Locally, `gcloud auth application-default login` provides one.

## Receiving OTLP/JSON

`OtlpMetricsReceiver` turns the body of an OTLP/HTTP `POST /v1/metrics` sent as JSON into minute buckets, so other services' metrics land in the same store. It needs no OTel packages.

```typescript
import { OtlpMetricsReceiver } from '@maroonedsoftware/telemetry';

const receiver = new OtlpMetricsReceiver({ maxSeriesPerName: 50, maxNames: 500 }); // keep one per process

const { buckets, dropped, unsupported } = receiver.receive(body);
await store.upsertMinutes(buckets, 'otlp');
```

Gauges and up-down sums are read as values; monotonic sums and histograms contribute their increase, with cumulative series differenced against their previous point. Exponential histograms and summaries are counted as unsupported. Senders must use `http/json`, not protobuf.

## Reading an aggregate

| Kind     | Read                                        |
| -------- | ------------------------------------------- |
| Gauge    | `last`, or `sum / count` for the mean       |
| Counter  | `sum`                                       |
| Duration | `sum / count` for the mean, `max` for worst |

Percentiles need a distribution. Give the recorder bucket bounds for the metrics that should have one, and it also counts their observations into those buckets; the OTLP bridge sends them as an explicit-bucket histogram (Google Cloud refuses a histogram without bounds). The PostgreSQL store keeps only the five numbers.

```typescript
import { DURATION_BOUNDS_MS } from '@maroonedsoftware/telemetry';

recorder.bucketBounds = name => (name.endsWith('.ms') ? DURATION_BOUNDS_MS : undefined);
```

## License

MIT
