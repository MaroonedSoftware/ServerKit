# @maroonedsoftware/telemetry

## 0.1.0

### Minor Changes

- 68dce0e: Add `@maroonedsoftware/telemetry/kysely`: a `MetricsStore` that keeps metric buckets in one PostgreSQL table at minute and hour resolution. Upserts merge a later flush of the same minute into the stored row, `rollupHour` folds an hour of minutes into an hour row idempotently, `prune` ages each resolution out on its own window, and `series` / `names` read them back. Also adds `resolutionFor` to the root entry. `kysely` is an optional peer.
- 71ff5a1: Add `@maroonedsoftware/telemetry/otlp`: `OtlpMetricsBridge` sends drained minute buckets to any OTel push exporter as already-aggregated delta data (gauge, monotonic sum or histogram, chosen per name), and `OtlpSpanBridge` sends `FinishedSpan`s (work described after the fact, with the app's own ids) as finished spans with their recorded times. Adds `FinishedSpan` to the root entry. The OTel SDK packages are optional peers.
- 741a327: Add `OtlpMetricsReceiver`: reads OTLP/JSON metric exports from other services into the same minute buckets. Gauges and up-down sums are read as values; monotonic sums and histograms contribute their increase, with cumulative series differenced against their previous point and re-baselined when the sender restarts. Label sets per name and names overall are capped for the receiver's life, and anything dropped or unreadable is counted rather than thrown. Needs no OTel packages.
- cf09fd0: Add `@maroonedsoftware/telemetry`: an in-process `MetricsRecorder` that folds observations into one-minute buckets of five numbers (`count`, `sum`, `min`, `max`, `last`), with a gauge registry sampled on each pass or at its own cadence. The recorder does no I/O; the app's own loop drains it and writes the buckets wherever it keeps metrics.
