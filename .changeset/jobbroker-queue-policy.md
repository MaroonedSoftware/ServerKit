---
'@maroonedsoftware/jobbroker': minor
---

Add configurable per-queue retry and dead-letter policy, plus dead-letter monitoring, to the pg-boss backend.

- **Retry & dead-letter policy.** A new `JobQueuePolicy` (retry limit, retry delay, exponential backoff, backoff cap, expiry, and a dead-letter queue name — durations as Luxon `Duration`s) can be declared on a `PgBossJobRegistration` where the job is mapped. `PgBossJobRunner` threads the policy into pg-boss `createQueue`/`updateQueue`: absent queues are created with the options, existing queues are reconciled, and a referenced dead-letter queue is auto-created if it does not exist. A runner-level `defaultQueuePolicy` applies shared defaults beneath each queue's own policy.
- **Dead-letter monitoring.** A new `JobMonitor` abstraction (with `PgBossJobMonitor`) lets a consumer observe and remediate queues: `getQueueStats` (depth/health for alerting), `listJobs` (inspect poison messages), `redrive` (move dead-lettered jobs back to their source, rate-limited), `deleteJob` (discard), and `retryJob` (re-attempt in place). It operates on raw queue names without a registry check, so unregistered dead-letter sinks are serviceable.

Fully backward-compatible: queues with no policy are created exactly as before, `PgBossJobRegistration.cron` is now optional so a policy can be attached to on-demand jobs, and the monitor is additive.
