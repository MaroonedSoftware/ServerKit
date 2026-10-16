---
'@maroonedsoftware/telemetry': minor
---

Add `OtlpMetricsReceiver`: reads OTLP/JSON metric exports from other services into the same minute buckets. Gauges and up-down sums are read as values; monotonic sums and histograms contribute their increase, with cumulative series differenced against their previous point and re-baselined when the sender restarts. Label sets per name and names overall are capped for the receiver's life, and anything dropped or unreadable is counted rather than thrown. Needs no OTel packages.
