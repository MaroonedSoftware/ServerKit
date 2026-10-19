---
'@maroonedsoftware/telemetry': minor
---

`OtlpMetricsBridge` takes `temporality: 'cumulative'`: counters and histograms then go out as each series' running total, from its first minute to the export time, one point per series per export. Prometheus and Google Cloud's Managed Service for Prometheus keep them as they arrive, with no `deltatocumulative` processor in a collector. A minute exported in parts adds up, and a failed export is caught up by the next one. `export` takes an optional `now`, the cumulative points' end time. The default stays `delta`, unchanged.
