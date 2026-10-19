# AGENTS.md — @maroonedsoftware/telemetry

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Collects application metrics into one-minute buckets in memory (`MetricsRecorder`), so an app can keep
its own numbers over time and chart them. Not an OpenTelemetry SDK replacement: it holds aggregates, not
raw observations, with bucket counts only for metrics given bounds (`bucketBounds`). Reach for the OTel SDK directly when you only need to ship
metrics to a collector and never read them back.

## Install

```bash
pnpm add @maroonedsoftware/telemetry injectkit reflect-metadata
```

Required peers: none beyond `injectkit`'s own `reflect-metadata`.
Optional peers: `kysely` — unlocks the `./kysely` subpath (`MetricsStore`). `@opentelemetry/api`, `/core`,
`/resources`, `/sdk-metrics` and `/sdk-trace` — unlock the `./otlp` subpath. The OTLP exporters themselves
(`@opentelemetry/exporter-metrics-otlp-http` and the like) are the app's choice and not peers.
`google-auth-library` and `@opentelemetry/resources` — unlock the `./google` subpath.

## Position in the graph

- **Depends on:** nothing internal
- **Depended on by:** nothing internal
- **Subpath exports:** `./kysely` — `MetricsStore`, the PostgreSQL store; a subpath so the root entry stays free of `kysely`
- **Subpath exports:** `./otlp` — `OtlpMetricsBridge`, `OtlpSpanBridge` and the id helpers; a subpath so the root entry stays free of the OTel SDK
- **Subpath exports:** `./google` — auth headers and a resource for Google Cloud's Telemetry API; a subpath so nothing else loads Google's auth library

## API surface

| Export                       | Kind      | Shape                                                                                                                                                                  | Notes                                                                              |
| ---------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `MetricsRecorder`            | class     | `observe(name, value, labels?, at?)`, `gauge(name, read, options?)`, `sampleGauges(now?)`, `drain()`, `drainClosed(now?)`, `pending`, `onGaugeError?`, `bucketBounds?` | `@Injectable()`; register as a singleton                                           |
| `GaugeReader`                | type      | `() => number \| undefined \| Promise<number \| undefined>`                                                                                                            | `undefined` records nothing                                                        |
| `GaugeOptions`               | interface | `{ labels?: MetricLabels; every?: Duration }`                                                                                                                          | `every` defaults to zero (every pass)                                              |
| `GaugeErrorHandler`          | type      | `(name: string, error: unknown) => void`                                                                                                                               |                                                                                    |
| `MetricAggregate`            | interface | `{ count, sum, min, max, last, buckets? }`                                                                                                                             |                                                                                    |
| `aggregateOf`                | function  | `(value: number) => MetricAggregate`                                                                                                                                   |                                                                                    |
| `bucketedAggregateOf`        | function  | `(value, bounds) => MetricAggregate`                                                                                                                                   | also counts the value into `buckets`                                               |
| `MetricBuckets`              | interface | `{ bounds: readonly number[]; counts: number[] }`                                                                                                                      | OTLP explicit buckets: `(bounds[i-1], bounds[i]]`, one overflow count              |
| `validBounds`                | function  | `(bounds) => boolean`                                                                                                                                                  | finite and strictly ascending                                                      |
| `DURATION_BOUNDS_MS`         | const     | `readonly number[]`                                                                                                                                                    | 5 ms to 10 minutes                                                                 |
| `mergeAggregates`            | function  | `(previous, next) => MetricAggregate`                                                                                                                                  | associative; `last` is taken from `next`; buckets kept only when both share bounds |
| `MetricBucket`               | interface | `{ name, labels, labelsKey, start: DateTime, aggregate }`                                                                                                              | `start` is the UTC minute                                                          |
| `minuteOf`                   | function  | `(at: DateTime) => DateTime`                                                                                                                                           | UTC start of minute                                                                |
| `MetricLabels`               | type      | `Readonly<Record<string, string>>`                                                                                                                                     | string values only                                                                 |
| `labelsKey`                  | function  | `(labels: MetricLabels) => string`                                                                                                                                     | sorted JSON; `'{}'` for none                                                       |
| `FinishedSpan`               | interface | `{ traceId, spanId, parentSpanId?, name, start, end, ok, error?, attributes?, links? }`                                                                                | the app's own ids; work already done                                               |
| `SpanLink`                   | interface | `{ traceId, spanId }`                                                                                                                                                  |                                                                                    |
| `SpanAttributeValue`         | type      | `string \| number \| boolean`                                                                                                                                          |                                                                                    |
| `OtlpMetricsReceiver`        | class     | `new OtlpMetricsReceiver({ maxSeriesPerName?, maxNames? })`; `receive(body, now?) => OtlpReceiveResult`                                                                | OTLP/JSON only; holds cumulative baselines and the caps; one per process           |
| `OtlpMetricsReceiverOptions` | interface | `{ maxSeriesPerName?: number; maxNames?: number }`                                                                                                                     | defaults 50 and 500                                                                |
| `OtlpReceiveResult`          | interface | `{ buckets: MetricBucket[]; dropped: number; unsupported: number }`                                                                                                    |                                                                                    |
| `OtlpPayloadError`           | class     | `extends Error`                                                                                                                                                        | body is not a metrics export; answer 400                                           |
| `MetricResolution`           | type      | `'minute' \| 'hour'`                                                                                                                                                   |                                                                                    |
| `resolutionFor`              | function  | `(from, to, limit?) => MetricResolution`                                                                                                                               | minutes up to `limit` (48h), else hours                                            |
| `MINUTE_RESOLUTION_LIMIT`    | const     | `Duration` (48 hours)                                                                                                                                                  |                                                                                    |

### `./kysely`

| Export                | Kind      | Shape                                                                                                                                                                | Notes                                                                         |
| --------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `MetricsStore<DB>`    | class     | `new MetricsStore(db: Kysely<DB>, options)`; `upsertMinutes(buckets, source?)`, `rollupHour(hour)`, `prune(resolution, olderThan, now?)`, `series(query)`, `names()` | runs on `db.withoutPlugins()`; not `@Injectable()`, construct it in a factory |
| `MetricsStoreOptions` | interface | `{ table: string; scope?: Record<string, string>; batchSize?: number }`                                                                                              | `scope` columns must be in the primary key                                    |
| `MetricSeriesQuery`   | interface | `{ names, from, to, resolution, labels? }`                                                                                                                           | `to` is exclusive; `labels` matches with `@>`                                 |
| `MetricSeries`        | interface | `{ name, labels, labelsKey, source, points: MetricPoint[] }`                                                                                                         | points oldest first                                                           |
| `MetricPoint`         | interface | `{ start: DateTime; aggregate: MetricAggregate }`                                                                                                                    |                                                                               |
| `MetricName`          | interface | `{ name, source, labelKeys: string[], lastSeen: DateTime }`                                                                                                          |                                                                               |

### `./otlp`

| Export                     | Kind      | Shape                                                                                                                  | Notes                                                                                                                |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `OtlpMetricsBridge`        | class     | `new OtlpMetricsBridge({ exporter, resource?, scope?, kindOf?, temporality? })`; `export(buckets, now?)`, `shutdown()` | builds `ResourceMetrics` directly, no `MeterProvider`; cumulative mode keeps a running total per series for its life |
| `OtlpMetricsBridgeOptions` | interface | as above                                                                                                               | `kindOf` defaults to `gauge`, `temporality` to `delta`                                                               |
| `MetricTemporality`        | type      | `'delta' \| 'cumulative'`                                                                                              | how counters and histograms are reported; gauges are unaffected                                                      |
| `MetricKind`               | type      | `'gauge' \| 'counter' \| 'histogram'`                                                                                  | gauge → `last`, counter → `sum`, histogram → count/sum/min/max                                                       |
| `OtlpSpanBridge`           | class     | `new OtlpSpanBridge({ exporter, resource?, scope? })`; `export(spans)`, `shutdown()`                                   | builds finished `ReadableSpan`s with recorded times                                                                  |
| `OtlpSpanBridgeOptions`    | interface | as above                                                                                                               |                                                                                                                      |
| `otlpTraceId`              | function  | `(id: string) => string`                                                                                               | 32 hex; kept if already, else sha256-derived                                                                         |
| `otlpSpanId`               | function  | `(id: string) => string`                                                                                               | 16 hex; same rule                                                                                                    |

### `./google`

| Export                                | Kind      | Shape                                                                                | Notes                                                                                                         |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_TELEMETRY_URL`                | const     | `'https://telemetry.googleapis.com'`                                                 | the OTLP base URL                                                                                             |
| `googleTracesUrl`, `googleMetricsUrl` | const     | the base URL plus `/v1/traces`, `/v1/metrics`                                        | for an exporter's `url`                                                                                       |
| `isGoogleTelemetryUrl`                | function  | `(url?: string) => boolean`                                                          | matches the host only                                                                                         |
| `googleOtlpHeaders`                   | function  | `(auth?: GoogleAuth) => OtlpHeadersFactory`                                          | an exporter's `headers`; ADC, `cloud-platform` scope, fresh per export                                        |
| `OtlpHeadersFactory`                  | type      | `() => Promise<Record<string, string>>`                                              |                                                                                                               |
| `googleCloudResource`                 | function  | `(options?) => Resource`                                                             | `gcp.project_id`, `cloud.region`, `service.instance.id`, `service.name`; metadata values are async attributes |
| `GoogleCloudResourceOptions`          | interface | `{ projectId?, region?, serviceName?, metadata?, metadataTimeoutMs?, env?, fetch? }` |                                                                                                               |

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

Exporting over OTLP:

```typescript
import { OtlpMetricsBridge, OtlpSpanBridge } from '@maroonedsoftware/telemetry/otlp';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const metrics = new OtlpMetricsBridge({ exporter: new OTLPMetricExporter({ url }), kindOf: name => (name.endsWith('.ms') ? 'histogram' : 'gauge') });
const spans = new OtlpSpanBridge({ exporter: new OTLPTraceExporter({ url }) });

const buckets = recorder.drain();
await store.upsertMinutes(buckets);
await metrics.export(buckets).catch(log); // a dead collector must not stop the store write
await spans.export(finishedSinceLastFlush);
```

Exporting straight to Google Cloud (Cloud Trace and Cloud Monitoring), with no collector:

```typescript
import { googleCloudResource, googleMetricsUrl, googleOtlpHeaders } from '@maroonedsoftware/telemetry/google';
import { OtlpMetricsBridge } from '@maroonedsoftware/telemetry/otlp';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';

const resource = googleCloudResource(); // share it with the trace SDK, so both report one instance
const metrics = new OtlpMetricsBridge({
  exporter: new OTLPMetricExporter({ url: googleMetricsUrl, headers: googleOtlpHeaders() }),
  resource,
  temporality: 'cumulative',
  kindOf,
});
```

Receiving OTLP/JSON from other services, in the app's own route:

```typescript
import { OtlpMetricsReceiver, OtlpPayloadError } from '@maroonedsoftware/telemetry';

const receiver = new OtlpMetricsReceiver({ maxSeriesPerName: 50 }); // a singleton

const { buckets, dropped } = receiver.receive(ctx.request.body); // throws OtlpPayloadError → 400
await store.upsertMinutes(buckets, 'otlp');
ctx.body = dropped > 0 ? { partialSuccess: { rejectedDataPoints: String(dropped) } } : {};
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

- Export to OTLP after the store write, and never let an export failure skip or retry the store write.
- Give every metric that is a duration or a count a `kindOf` answer; the default sends everything as a gauge.

- Keep one `OtlpMetricsReceiver` per process. A new one per request loses every cumulative baseline, so
  cumulative sums and histograms never produce a point.
- Put received metrics behind authentication and a size limit on the body: the caps bound rows, not bytes.

- Send to Google with `temporality: 'cumulative'` and a resource from `googleCloudResource()`, shared by every
  exporter in the process. Google keeps delta sums only as Cloud Monitoring delta metrics, which PromQL cannot
  rate, and refuses a batch without `gcp.project_id`, and metrics without a real `cloud.region` (never `global`):
  off Google Cloud, set `GOOGLE_CLOUD_REGION`.
- Give every histogram sent to Google bucket bounds (`recorder.bucketBounds`): Google refuses a histogram with none.
- Give the identity the process runs as `roles/telemetry.writer` on the project and
  `roles/serviceusage.serviceUsageConsumer` on the quota project.

## Gotchas

- `drain()` includes the still-open minute. A store must merge (upsert) rather than insert, or a
  minute flushed twice is double-counted or rejected. A delta OTLP export sends each point once, so
  feed it `drainClosed(now)`, which keeps the open minute until it has ended.
- The bridge's default is delta. A collector feeding Prometheus (or Google's Managed Prometheus) needs the
  `deltatocumulative` processor, unless the bridge is built with `temporality: 'cumulative'`, which needs
  neither that nor `drainClosed` (a minute exported in parts adds up). Cumulative state lasts for the
  bridge's life, one entry per series, so keep one bridge per process and label values from a small set.
- `otlpTraceId` hashes, so a trace id is only stable for the same app id string. Two apps sharing a trace
  must agree on the id string, or pass real 32-hex ids.
- The receiver reads OTLP/JSON only. A sender on the default `http/protobuf` encoding must be switched to
  `http/json` (`OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=http/json`).
- A cumulative series' first point, and its first after a sender restart, produce nothing: they set the baseline.
- The caps last for the receiver's life. A dropped series stays dropped until the process restarts.
- `observe()` silently drops `NaN` and `Infinity`.
- `MetricsStore` ignores the app's Kysely plugins. Rows from `series()` are mapped by the store, never
  read raw, so a `CamelCasePlugin` cannot rename its columns underneath it.
- A gauge whose reader throws is marked sampled anyway, so it is retried at its `every` cadence, not on
  the next pass.

## Working inside this package

`src/` holds one concern per file (`metric.aggregate.ts`, `metric.labels.ts`, `metric.bucket.ts`,
`metric.resolution.ts`, `metrics.recorder.ts`) behind the `src/index.ts` barrel, `metrics.store.ts` behind the
`src/kysely.ts` subpath entry, the `otlp.*.ts` bridges behind `src/otlp.ts`, and the `google.*.ts` helpers behind
`src/google.ts`.
`otlp.metrics.receiver.ts` is in the root entry on purpose: it parses JSON and needs no OTel SDK; tests mirror them in `tests/`. Keep the root
entry free of I/O and of external SDKs. A new subpath needs an `exports` entry, a tsup entry in
`build`, and its SDK as an optional peer. Every user-visible change needs a changeset.
