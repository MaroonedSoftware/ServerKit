---
'@maroonedsoftware/telemetry': minor
---

Add `@maroonedsoftware/telemetry`: an in-process `MetricsRecorder` that folds observations into one-minute buckets of five numbers (`count`, `sum`, `min`, `max`, `last`), with a gauge registry sampled on each pass or at its own cadence. The recorder does no I/O; the app's own loop drains it and writes the buckets wherever it keeps metrics.
