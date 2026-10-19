---
'@maroonedsoftware/telemetry': minor
---

Histograms can carry their distribution. Set `MetricsRecorder.bucketBounds` to give metrics bucket bounds (`DURATION_BOUNDS_MS` covers 5 ms to 10 minutes), and their observations are also counted into `MetricAggregate.buckets`, which merge by adding when the bounds match. `OtlpMetricsBridge` sends them as an explicit-bucket histogram, so collectors and Google Cloud get percentiles; Google refused the bridge's histograms before, since they had no bounds. Adds `bucketedAggregateOf`, `MetricBuckets` and `validBounds`. `aggregateOf` is unchanged, and `MetricsStore` keeps only the five numbers.
