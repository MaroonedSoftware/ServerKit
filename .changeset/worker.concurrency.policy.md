---
'@maroonedsoftware/jobbroker': minor
---

Add `JobWorkerPolicy` and `PermanentJobError`, and settle each job in a batch on its own.

`PgBossJobRunner.start()` registered every worker with `pgboss.work(name, handler)` — the two-argument
overload — and exposed no property that would feed a third. pg-boss defaults `localConcurrency` and
`batchSize` to 1, so every ServerKit queue ran a single worker fetching one job at a time and there was
no supported way to change that short of subclassing the runner.

Declare a `worker` policy on the registration, or set `defaultWorkerPolicy` on the runner for a
baseline every queue inherits. The two merge field-by-field, the same way `defaultQueuePolicy` and a
registration's `policy` already do:

```typescript
registry.set('image.thumbnail', { job: ThumbnailJob, worker: { concurrency: 8 } });
```

`concurrency` is the knob for a queue that is falling behind — each unit is an independent worker
settling its own job. `batchSize` makes one worker fetch several jobs at once, trading round trips for
latency on any single job.

Workers now run with pg-boss's `perJobResults`, so the runner reports each job's outcome instead of
throwing. Previously one rejection failed the entire batch, and every job in it was retried — including
the ones that had already succeeded. A poison message now fails, retries, and dead-letters alone, with
its own error as its own output. When more than one job in a batch fails, the batch-wide view is kept
as a logged `ServerkitError` whose cause is an `AggregateError` of every failure.

Per-job settlement also makes a new disposition reachable. A job that throws `PermanentJobError`
declares its failure permanent: it skips its remaining retries and dead-letters on the first attempt,
instead of spending a full retry budget on input that can never succeed.

```typescript
throw new PermanentJobError('Malformed webhook payload').withDetails({ issues });
```

The match is a direct `instanceof`, so wrapping a transient error in one makes it permanent, while a
transient error that merely carries one as its cause stays retryable. Anything else a handler throws is
still treated as transient and retried exactly as before.

The `pg-boss` peer floor moves from `^12.5.4` to `^12.21.0`: `localConcurrency` arrived in 12.6.0 and
`perJobResults` in 12.21.0. An older peer would ignore `perJobResults`, take the handler's result array
as the batch's single output, and mark every job complete — including the failed ones.
