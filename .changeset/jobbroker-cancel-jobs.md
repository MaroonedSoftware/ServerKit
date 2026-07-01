---
"@maroonedsoftware/jobbroker": minor
---

Add job cancellation and management to `JobBroker`. `send` now returns the new job id, and the broker gains `cancel`, `resume`, `deleteJob`, and `getJob`. `cancel` stops a job whether it is still queued or already running: running jobs are cancelled cooperatively via an `AbortSignal` now passed to `Job.run(payload, signal)`, and the `PgBossJobRunner` polls for cancellation (configurable via `cancelPollIntervalSeconds`) so cancellation works across processes. Adds a normalized `JobInfo`/`JobState` and a `NotSupportedError` so alternative backends can declare unsupported operations. Backward compatible — existing handlers that ignore the signal and callers that ignore the returned id keep working.
