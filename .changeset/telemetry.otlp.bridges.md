---
'@maroonedsoftware/telemetry': minor
---

Add `@maroonedsoftware/telemetry/otlp`: `OtlpMetricsBridge` sends drained minute buckets to any OTel push exporter as already-aggregated delta data (gauge, monotonic sum or histogram, chosen per name), and `OtlpSpanBridge` sends `FinishedSpan`s (work described after the fact, with the app's own ids) as finished spans with their recorded times. Adds `FinishedSpan` to the root entry. The OTel SDK packages are optional peers.
