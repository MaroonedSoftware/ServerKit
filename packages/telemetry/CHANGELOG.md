# @maroonedsoftware/telemetry

## 0.3.0

### Minor Changes

- 04ae0e7: Histograms can carry their distribution. Set `MetricsRecorder.bucketBounds` to give metrics bucket bounds (`DURATION_BOUNDS_MS` covers 5 ms to 10 minutes), and their observations are also counted into `MetricAggregate.buckets`, which merge by adding when the bounds match. `OtlpMetricsBridge` sends them as an explicit-bucket histogram, so collectors and Google Cloud get percentiles; Google refused the bridge's histograms before, since they had no bounds. Adds `bucketedAggregateOf`, `MetricBuckets` and `validBounds`. `aggregateOf` is unchanged, and `MetricsStore` keeps only the five numbers.

### Patch Changes

- 5cc7419: `googleCloudResource()` takes the region from a `region` option or `GOOGLE_CLOUD_REGION` before asking the metadata server. Google refuses metrics without a real `cloud.region` (and refuses `global`), and off Google Cloud there is no metadata server to ask, so a process exporting from a laptop or another cloud had every metric refused as an unrecognized location.

## 0.2.0

### Minor Changes

- 841100f: `OtlpMetricsBridge` takes `temporality: 'cumulative'`: counters and histograms then go out as each series' running total, from its first minute to the export time, one point per series per export. Prometheus and Google Cloud's Managed Service for Prometheus keep them as they arrive, with no `deltatocumulative` processor in a collector. A minute exported in parts adds up, and a failed export is caught up by the next one. `export` takes an optional `now`, the cumulative points' end time. The default stays `delta`, unchanged.
- c6481d9: Add `MetricsRecorder.drainClosed(now?)`: it hands over only the minutes that have ended and keeps the open minute's buckets for a later drain. A delta OTLP export fed by `drain()` sent the rest of a minute flushed early as a second point over the same interval; fed by `drainClosed()`, each minute goes out once and whole. `drain()` is unchanged.
- 2cf5750: Add `@maroonedsoftware/telemetry/google`, for exporting OTLP straight to Google Cloud's Telemetry API (Cloud Trace and Cloud Monitoring) with no collector. `googleOtlpHeaders()` gives an exporter Application Default Credentials headers, fresh for every export. `googleCloudResource()` describes the process the way Google needs: `gcp.project_id`, `cloud.region` and a `service.instance.id` unique to the process, read from the environment and the metadata server as asynchronous attributes. Also exports the endpoint URLs and `isGoogleTelemetryUrl`. `google-auth-library` is an optional peer. `OtlpMetricsBridge` and `OtlpSpanBridge` now wait for a resource's asynchronous attributes before exporting.

## 0.1.1

### Patch Changes

- a1ddd60: `MetricsStore.series` and `names` now read a `timestamptz` the pool has already parsed into a Luxon `DateTime`, which is what `@maroonedsoftware/kysely`'s `KyselyPgTypeOverrides` does. They threw a `TypeError` on such a pool before.
- 51323cf: `MetricsStore` is generic over the app's database type, so an app's own `Kysely<DB>` is accepted without a cast. A typed `Kysely<DB>` was not assignable to the `Kysely<unknown>` it took before, so it could not be passed at all without one.

## 0.1.0

### Minor Changes

- 68dce0e: Add `@maroonedsoftware/telemetry/kysely`: a `MetricsStore` that keeps metric buckets in one PostgreSQL table at minute and hour resolution. Upserts merge a later flush of the same minute into the stored row, `rollupHour` folds an hour of minutes into an hour row idempotently, `prune` ages each resolution out on its own window, and `series` / `names` read them back. Also adds `resolutionFor` to the root entry. `kysely` is an optional peer.
- 71ff5a1: Add `@maroonedsoftware/telemetry/otlp`: `OtlpMetricsBridge` sends drained minute buckets to any OTel push exporter as already-aggregated delta data (gauge, monotonic sum or histogram, chosen per name), and `OtlpSpanBridge` sends `FinishedSpan`s (work described after the fact, with the app's own ids) as finished spans with their recorded times. Adds `FinishedSpan` to the root entry. The OTel SDK packages are optional peers.
- 741a327: Add `OtlpMetricsReceiver`: reads OTLP/JSON metric exports from other services into the same minute buckets. Gauges and up-down sums are read as values; monotonic sums and histograms contribute their increase, with cumulative series differenced against their previous point and re-baselined when the sender restarts. Label sets per name and names overall are capped for the receiver's life, and anything dropped or unreadable is counted rather than thrown. Needs no OTel packages.
- cf09fd0: Add `@maroonedsoftware/telemetry`: an in-process `MetricsRecorder` that folds observations into one-minute buckets of five numbers (`count`, `sum`, `min`, `max`, `last`), with a gauge registry sampled on each pass or at its own cadence. The recorder does no I/O; the app's own loop drains it and writes the buckets wherever it keeps metrics.
