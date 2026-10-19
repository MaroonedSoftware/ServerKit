---
'@maroonedsoftware/telemetry': minor
---

Add `MetricsRecorder.drainClosed(now?)`: it hands over only the minutes that have ended and keeps the open minute's buckets for a later drain. A delta OTLP export fed by `drain()` sent the rest of a minute flushed early as a second point over the same interval; fed by `drainClosed()`, each minute goes out once and whole. `drain()` is unchanged.
