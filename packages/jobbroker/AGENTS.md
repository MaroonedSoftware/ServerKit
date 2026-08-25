# AGENTS.md — @maroonedsoftware/jobbroker

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Durable background jobs behind a backend-agnostic interface: `JobBroker` for the producer side
(send, schedule, cancel, inspect), `Job` for the handler, `JobRunner` for the worker lifecycle, and
`JobMonitor` for queue stats, dead-letter listing, and redrive. `JobContext` is the job-side
counterpart of a request context — inject it and any service in the graph knows which job it is
running under. The bundled backend is pg-boss over PostgreSQL.

Reach for this when work must survive a process restart, be retried, be scheduled, or happen after
the response. Do **not** reach for it for synchronous in-process fan-out — that is
`@maroonedsoftware/eventbus`.

## Install

```bash
pnpm add @maroonedsoftware/jobbroker
pnpm add pg-boss   # only for the ./pgboss backend
```

Runtime dependencies: `@maroonedsoftware/errors`, `@maroonedsoftware/logger`, `injectkit`, `luxon`.
Optional peer: `pg-boss`.

## Position in the graph

- **Depends on:** `errors`, `logger`.
- **Depended on by:** nothing internal. It is a leaf that applications wire up directly.
- **Subpath exports:**
  - `.` — the backend-agnostic abstractions. Loads no `pg-boss`.
  - `./pgboss` — the pg-boss backend. Pulls in the optional peer.

Notably **not** a dependency: `kysely`. Transactional enqueue is supported through a _structural_
`KyselyLike` interface, so this package needs no dependency on `kysely`, not even an optional peer.

## API surface

### `.` — abstractions

| Export                               | Kind                       | Shape                                                                                                                        | Notes                                                                                                      |
| ------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Job<Payload>`                       | abstract class             | `@Injectable() abstract run(payload: Payload, signal?: AbortSignal): Promise<void>`                                          | `Payload extends object = object`.                                                                         |
| `JobBroker`                          | abstract class             | `@Injectable()`. Producer side.                                                                                              | Unsupported operations throw `NotSupportedError` rather than no-op.                                        |
| `#send`                              | method                     | `<P extends object>(name: string, payload: P, options?: JobSendOptions) => Promise<string>`                                  | Returns the job id. Throws if `name` is not registered.                                                    |
| `#schedule`                          | method                     | `<P extends object>(name: string, cron: string, payload?: P) => Promise<void>`                                               | —                                                                                                          |
| `#unschedule`                        | method                     | `(name: string) => Promise<void>`                                                                                            | —                                                                                                          |
| `#cancel` / `#resume` / `#deleteJob` | method                     | `(name: string, id: string \| string[]) => Promise<void>`                                                                    | `cancel` aborts the signal for a running job.                                                              |
| `#getJob`                            | method                     | `<P extends object>(name: string, id: string) => Promise<JobInfo<P> \| null>`                                                | —                                                                                                          |
| `JobRunner`                          | abstract class             | `@Injectable()`. `start()`, `stop()`                                                                                         | Consumer side. `stop()` waits for in-flight jobs.                                                          |
| `JobMonitor`                         | abstract class             | `@Injectable()`. `getQueueStats`, `listJobs`, `redrive`, `deleteJob`, `retryJob`                                             | Operational surface — dashboards, dead-letter drains.                                                      |
| `JobContext`                         | interface + abstract class | `{ id: string; name: string; signal: AbortSignal; expiresIn?: Duration }`                                                    | Declaration-merged so one symbol is both the type and the DI token.                                        |
| `registerJobContext`                 | function                   | `<T extends Registry>(registry: T) => T`                                                                                     | **Required** if any service injects `JobContext`. Registers a throwing placeholder.                        |
| `JobSendOptions`                     | interface                  | `{ startAfter?: Duration \| DateTime }`                                                                                      | Relative delay or absolute earliest-run time. A lower bound, not exact scheduling.                         |
| `JobQueuePolicy`                     | interface                  | `{ retryLimit?, retryDelay?: Duration, retryBackoff?, retryDelayMax?: Duration, expiresIn?: Duration, deadLetter?: string }` | Applied per queue when the runner starts. `expiresIn` is what surfaces as `JobContext.expiresIn`.          |
| `JobWorkerPolicy`                    | interface                  | `{ concurrency?: number, batchSize?: number, pollInterval?: Duration }`                                                      | Configures the worker **this node** starts, not the queue. Applied when the runner registers the worker.   |
| `JobInfo<Payload>`                   | interface                  | `{ id, name, state: JobState, data: Payload }`                                                                               | Lowest common denominator across backends.                                                                 |
| `JobState`                           | type                       | `'created' \| 'retry' \| 'active' \| 'completed' \| 'cancelled' \| 'failed'`                                                 | —                                                                                                          |
| `JobQueueStats`                      | interface                  | `{ name, queued, active, failed, total }`                                                                                    | `failed` is a **retained** count, not an all-time total.                                                   |
| `JobQueryOptions`                    | interface                  | `{ id?, data?: Record<string, unknown>, queuedOnly? }`                                                                       | `data` is a partial-match payload filter.                                                                  |
| `JobRedriveOptions`                  | interface                  | `{ destination?, sourceName?, limit? }`                                                                                      | Without `destination`, each job returns to its original queue.                                             |
| `NotSupportedError`                  | class                      | `extends ServerkitError`                                                                                                     | Thrown by a backend that cannot honour an operation.                                                       |
| `PermanentJobError`                  | class                      | `extends ServerkitError`. `new (message, options?: { cause?: unknown })`                                                     | Thrown by a job to skip its remaining retries and dead-letter immediately. Matched by direct `instanceof`. |

### `./pgboss`

| Export                                | Kind      | Shape                                                                                        | Notes                                                                                                                                                  |
| ------------------------------------- | --------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PgBossJobBroker`                     | class     | `extends JobBroker`                                                                          | Supports every `JobBroker` operation.                                                                                                                  |
| `PgBossJobRunner`                     | class     | `extends JobRunner`                                                                          | Creates the per-execution scope and registers the live `JobContext`. Fields: `cancelPollIntervalSeconds`, `defaultQueuePolicy`, `defaultWorkerPolicy`. |
| `PgBossJobMonitor`                    | class     | `extends JobMonitor`                                                                         | —                                                                                                                                                      |
| `PgBossJobRegistration`               | type      | `{ job: Identifier<Job>; cron?: string; policy?: JobQueuePolicy; worker?: JobWorkerPolicy }` | `policy` configures the queue, `worker` configures this node's worker.                                                                                 |
| `PgBossJobRegistryMap`                | class     | `extends Map<string, Identifier<Job> \| PgBossJobRegistration>`                              | Job name → handler. Read by both the broker (validation) and the runner.                                                                               |
| `PgBossConnectionProvider`            | class     | `@Injectable()`. `executor(): Db \| undefined`                                               | Default returns `undefined` — pg-boss uses its own pool.                                                                                               |
| `KyselyTransactionConnectionProvider` | class     | `extends PgBossConnectionProvider`. `new (trx: KyselyLike)`                                  | Enqueue inside the caller's transaction. Strips Kysely plugins first.                                                                                  |
| `KyselyLike`                          | interface | `{ withoutPlugins(): … }`                                                                    | Structural, so no `kysely` dependency. Accepts `Kysely<DB>` and `Transaction<DB>`.                                                                     |

## Canonical usage

```typescript
import { Injectable, InjectKitRegistry } from 'injectkit';
import { Job, JobBroker, JobRunner, JobContext, registerJobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker, PgBossJobRunner, PgBossJobRegistryMap } from '@maroonedsoftware/jobbroker/pgboss';
import { Duration } from 'luxon';

interface SendReceiptPayload {
  orderId: string;
}

@Injectable()
class SendReceiptJob extends Job<SendReceiptPayload> {
  constructor(private readonly mailer: Mailer) {
    super();
  }

  async run(payload: SendReceiptPayload, signal?: AbortSignal): Promise<void> {
    await this.mailer.sendReceipt(payload.orderId, { signal });
  }
}

// Composition root
const jobs = new PgBossJobRegistryMap();
jobs.set('order.receipt.send', SendReceiptJob);
jobs.set('report.daily', { job: DailyReportJob, cron: '0 9 * * *' });
jobs.set('webhook.deliver', {
  job: DeliverWebhookJob,
  policy: { retryLimit: 5, retryDelay: Duration.fromObject({ seconds: 30 }), retryBackoff: true, deadLetter: 'webhook.deliver.dead' },
});
jobs.set('image.thumbnail', { job: ThumbnailJob, worker: { concurrency: 8 } });

// Inside a handler: skip the retries for input that can never succeed.
//   throw new PermanentJobError('Malformed payload').withDetails({ issues });

registerJobContext(registry); // required because services inject JobContext
registry.register(PgBossJobRegistryMap).useValue(jobs);
registry.register(SendReceiptJob).useClass(SendReceiptJob).asTransient();
registry.register(JobBroker).useClass(PgBossJobBroker).asSingleton();
registry.register(JobRunner).useClass(PgBossJobRunner).asSingleton();

// Enqueue
const id = await broker.send('order.receipt.send', { orderId }, { startAfter: Duration.fromObject({ minutes: 5 }) });
```

Transactional enqueue — the job row commits with the business writes or not at all:

```typescript
import { PgBossConnectionProvider, KyselyTransactionConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';

await db.transaction().execute(async trx => {
  const scope = container.createScope();
  scope.override(PgBossConnectionProvider, new KyselyTransactionConnectionProvider(trx));

  await orders.create(trx, order);
  await scope.get(JobBroker).send('order.receipt.send', { orderId: order.id });
});
```

See [.claude/skills/job](../../.claude/skills/job) for the generator and its examples.

## Rules for generated code

- Job names are catalog keys: dot notation, no hyphens (`order.receipt.send`, `report.daily`). The
  name is also the queue name.
- Register job classes as **transient**. A new instance per execution is what makes injecting
  request-shaped collaborators safe.
- Call `registerJobContext(registry)` before `build()` whenever any registered service injects
  `JobContext`. `Registry.build()` validates the graph up front, and the runner's per-execution
  override does not exist yet at that point.
- **Honour the `AbortSignal`.** Forward it to `fetch`, database calls, and long loops, or check
  `signal.aborted` between units of work. A handler that ignores it cannot be cancelled and blocks
  shutdown until it finishes.
- Keep payloads small and JSON-serialisable — they are stored as a database column. Pass an id, not
  an entity.
- Make handlers idempotent. At-least-once delivery plus retries means a job can run twice.
- Use `startAfter` with a Luxon `Duration` or `DateTime`, never a millisecond number.
- Give any queue that talks to an external service a `JobQueuePolicy` with `retryBackoff` and a
  `deadLetter` queue. Without one you get the backend's defaults and no dead-letter capture.
- A queue that is falling behind gets `worker: { concurrency: n }`, **not** `batchSize`. See the
  gotcha below — they are not interchangeable.
- Throw `PermanentJobError` for input that can never succeed (a malformed payload, a `422` from a
  receiver), and a plain `Error` for anything that might succeed on a retry (a timeout, a `503`, a
  rate limit). Getting this backwards either burns a retry budget on a hopeless job or dead-letters a
  blip on its first attempt. When in doubt, a plain `Error` is the safe default — it retries.
- Import pg-boss classes from `@maroonedsoftware/jobbroker/pgboss`, never from the root.
- Wire `runner.start()` into a module's `ready` hook and `runner.stop()` into `shutdown`. Starting
  in `start` delays boot for every module after it.
- Read the retry count from `JobMonitor`, not from `JobContext` — it is deliberately not there.

## Gotchas

- **`JobContext` throws when resolved outside a job.** `registerJobContext` registers a placeholder
  that throws with an explanation; the runner's scoped override shadows it during an execution. A
  service that must work in both a request and a job must not depend on `JobContext` directly.
- **`JobContext` carries no attempt or retry counter.** pg-boss hands the work handler a bare `Job`
  and the retry count lives on `JobWithMetadata`, which would cost an extra query per execution.
  This is a deliberate omission, not an oversight — use `JobMonitor`.
- **`startAfter` is a lower bound.** The job runs at the first opportunity after it becomes
  eligible, which under load can be much later. It is not a scheduler.
- **A backend that cannot honour an option throws `NotSupportedError`** rather than silently
  ignoring it. SQS caps delays at 15 minutes, for instance. pg-boss supports everything, so this
  only bites on a backend swap.
- **`JobWorkerPolicy.concurrency` and `batchSize` are not interchangeable.** `concurrency` spawns
  N independent workers, each fetching and settling its own job. `batchSize` makes _one_ worker
  fetch N jobs and hand them to the handler together, trading round trips for latency on any one
  job. Failure isolation is _not_ part of that trade — the runner reports a per-job outcome, so a
  poison message in a batch fails alone. Prefer `concurrency` for throughput anyway.
- **The runner always registers workers with `perJobResults: true`**, so its handler resolves with a
  `JobResult[]` instead of throwing. This is not optional and not tied to `batchSize`: it is what
  makes per-job settlement work, and the only route pg-boss offers to the `deadletter` disposition
  that `PermanentJobError` needs. Throwing from the handler still fails the _whole_ batch, which is
  correct for a runner-level bug but wrong for a job-level one — never rethrow a job's error there.
- **A job omitted from the returned `JobResult[]` is failed by pg-boss**, with
  `Error('no disposition returned by handler')`, and retried. Silence is not success, which is why
  the runner maps over `jobs` rather than over the `allSettled` results.
- **`PermanentJobError` is matched by direct `instanceof`, not by walking the `cause` chain.** The
  meaning is "this handler declared the failure permanent". Wrapping a transient error in one makes
  it permanent; a transient error that merely carries one as its cause stays retryable.
- **`JobWorkerPolicy` is not stored on the queue.** Unlike `JobQueuePolicy`, which the runner
  reconciles onto the queue via `createQueue`/`updateQueue`, a worker policy configures only the
  workers _this process_ starts. Two nodes on the same queue may use different values, and a change
  takes effect on the next runner start for that node alone.
- **The peer floor is pg-boss >= 12.21.0**, and it is load-bearing. `concurrency` maps to
  `localConcurrency` (added in 12.6.0) and per-job settlement to `perJobResults` (added in 12.21.0).
  An older peer would ignore `perJobResults`, take the handler's `JobResult[]` as the batch's single
  output, and mark **every job complete, including the failed ones**.
- **`JobQueueStats.failed` is a retained count**, bounded by the queue's retention policy, not an
  all-time total. It goes down on its own.
- **`KyselyTransactionConnectionProvider` strips plugins before adapting the transaction.**
  pg-boss runs raw SQL through `executeQuery`, so a camelCase plugin on your Kysely instance would
  rewrite pg-boss's _own_ result columns and corrupt them. `withoutPlugins()` returns an instance
  sharing the same connection-bound executor, so atomicity survives. Do not remove that call.
- **The default `PgBossConnectionProvider.executor()` returns `undefined`**, meaning pg-boss uses
  its own pool. Enqueues are therefore **not** transactional by default: a job can commit while the
  surrounding business transaction rolls back. Overriding it per request is opt-in.
- **`JobBroker.deleteJob` and `JobMonitor.deleteJob` are different methods on different classes**
  with the same name and signature. Check which token you are holding.
- **`cancel` on a running job aborts the signal** — it does not kill the handler. A handler that
  ignores the signal runs to completion regardless.
- **`JobContext` is declaration-merged** (interface + abstract class, same name), like `Logger`.
  That is what makes one symbol serve as both a type and a runtime DI token. Do not split it.

## Working inside this package

```
src/
  index.ts                 Root barrel — abstractions only
  job.ts                   Job
  job.broker.ts            JobBroker
  job.runner.ts            JobRunner
  job.monitor.ts           JobMonitor, JobQueueStats, JobQueryOptions, JobRedriveOptions
  job.context.ts           JobContext (interface + token), registerJobContext
  job.info.ts              JobState, JobInfo
  job.send.options.ts      JobSendOptions
  job.queue.policy.ts      JobQueuePolicy
  job.worker.policy.ts     JobWorkerPolicy
  not.supported.error.ts   NotSupportedError
  permanent.job.error.ts   PermanentJobError
  pgboss.ts                Subpath entry for ./pgboss
  pgboss/
    pgboss.job.broker.ts
    pgboss.job.runner.ts
    pgboss.job.monitor.ts
    pgboss.job.registration.ts             PgBossJobRegistration, PgBossJobRegistryMap
    pgboss.connection.provider.ts          PgBossConnectionProvider
    kysely.transaction.connection.provider.ts  KyselyTransactionConnectionProvider, KyselyLike
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import `pg-boss`.** That is the point of the
  `./pgboss` entry.
- **No dependency on `kysely`, not even optional.** `KyselyLike` is structural on purpose.
- The abstractions must stay lowest-common-denominator. A field only pg-boss can supply belongs on
  the pg-boss types, not on `JobInfo` or `JobContext` — that is why there is no attempt counter.
- An operation a backend cannot support throws `NotSupportedError`; it never silently no-ops.
- The runner owns creating the per-execution scope and registering the live `JobContext` against
  the token. Any new backend must do the same or `JobContext` injection breaks.
- A new backend gets its own `src/<name>.ts` entry, an `exports` entry, a tsup entry in the `build`
  script, and its client under `peerDependenciesMeta` as optional.

User-visible changes need a changeset in `.changeset/`.
