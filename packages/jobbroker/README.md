# @maroonedsoftware/jobbroker

A flexible background job processing library with support for scheduled and on-demand jobs. Currently ships with a [pg-boss](https://github.com/timgit/pg-boss) implementation for PostgreSQL-backed job queues.

## Features

- **Abstract interfaces** for easy testing and alternative implementations
- **Dependency injection** support via [injectkit](https://www.npmjs.com/package/injectkit)
- **Scheduled jobs** using cron expressions
- **On-demand jobs** for immediate execution
- **Cancellation** of queued _and_ running jobs, plus state lookup, delete, and resume
- **Per-queue retry & dead-letter policy** for retry limits, backoff, and poison-message capture
- **Dead-letter monitoring** to inspect, redrive, retry, or discard failed jobs
- **PostgreSQL backing** for reliability and transactional guarantees

## Installation

```bash
pnpm add @maroonedsoftware/jobbroker injectkit pg-boss reflect-metadata
```

> **Note:** InjectKit requires `reflect-metadata` to be imported at your application entry point and TypeScript configured with `experimentalDecorators: true` and `emitDecoratorMetadata: true`.

`pg-boss` is an optional peer dependency. The pg-boss backend lives behind a subpath export so importing the core (`@maroonedsoftware/jobbroker`) never loads it:

| Import                               | Contents                                                                                 | Pulls in      |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ------------- |
| `@maroonedsoftware/jobbroker`        | `Job`, `JobBroker`, `JobRunner`, `JobMonitor`, `JobInfo`, `JobState`, `JobQueuePolicy`, `NotSupportedError` | nothing extra |
| `@maroonedsoftware/jobbroker/pgboss` | `PgBossJobBroker`, `PgBossJobRunner`, `PgBossJobMonitor`, `PgBossJobRegistryMap`, `PgBossConnectionProvider` | `pg-boss`     |

## Quick Start

### 1. Define a Job

Create a job by extending the `Job` base class:

```typescript
import { Injectable } from 'injectkit';
import { Job } from '@maroonedsoftware/jobbroker';

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

@Injectable()
export class SendEmailJob extends Job<EmailPayload> {
  constructor(private readonly emailService: EmailService) {
    super();
  }

  async run(payload: EmailPayload, signal?: AbortSignal): Promise<void> {
    // Forward `signal` to async work so the job stops promptly when cancelled.
    await this.emailService.send(payload.to, payload.subject, payload.body, { signal });
  }
}
```

> The optional `signal` is aborted when the job is cancelled or the runner shuts down. Honoring it is how a long-running job becomes cancellable — see [Cancelling jobs](#cancelling-jobs).

### 2. Register Jobs

Create a registry and register your jobs:

```typescript
import { PgBossJobRegistryMap } from '@maroonedsoftware/jobbroker/pgboss';

const registry = new PgBossJobRegistryMap();

// On-demand job (triggered manually)
registry.set('send-email', SendEmailJob);

// Scheduled job (runs on a cron schedule)
registry.set('daily-report', {
  job: DailyReportJob,
  cron: '0 9 * * *', // Every day at 9 AM
});

// On-demand job with a retry / dead-letter policy (see "Retry & dead-letter policy")
registry.set('deliver-webhook', {
  job: DeliverWebhookJob,
  policy: {
    retryLimit: 5,
    retryDelay: Duration.fromObject({ seconds: 30 }),
    retryBackoff: true,
    deadLetter: 'deliver-webhook-dead',
  },
});
```

### 3. Set Up the Broker and Runner

```typescript
import 'reflect-metadata';
import { PgBoss } from 'pg-boss';
import { InjectKitRegistry } from 'injectkit';
import { ConsoleLogger, Logger } from '@maroonedsoftware/logger';
import { JobBroker, JobRunner, JobMonitor } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker, PgBossJobRunner, PgBossJobMonitor, PgBossJobRegistryMap, PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';

// Initialize pg-boss
const pgboss = new PgBoss('postgres://user:pass@localhost/mydb');

// Set up dependency injection registry
const diRegistry = new InjectKitRegistry();

diRegistry.register(PgBossJobRegistryMap).useInstance(registry);
diRegistry.register(PgBoss).useInstance(pgboss);
diRegistry.register(Logger).useClass(ConsoleLogger).asSingleton();
diRegistry.register(PgBossConnectionProvider).useClass(PgBossConnectionProvider).asSingleton();
diRegistry.register(JobBroker).useClass(PgBossJobBroker).asSingleton();
diRegistry.register(JobRunner).useClass(PgBossJobRunner).asSingleton();
diRegistry.register(JobMonitor).useClass(PgBossJobMonitor).asSingleton();

// Build the container
const container = diRegistry.build();

// Start the job runner (this also calls pgboss.start() internally)
const runner = container.get(JobRunner);
await runner.start();
```

### 4. Send Jobs

Use the broker to queue jobs for processing:

```typescript
const broker = container.get(JobBroker);

// Send an immediate job — returns the job id so you can reference it later
const id = await broker.send('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up.',
});

// Defer a job with a relative delay (Luxon Duration)...
await broker.send('send-email', payload, { startAfter: Duration.fromObject({ minutes: 5 }) });

// ...or until an absolute moment (Luxon DateTime)
await broker.send('send-email', payload, { startAfter: DateTime.now().plus({ hours: 2 }) });

// Inspect a job's current state
const info = await broker.getJob('send-email', id); // { id, name, state, data } | null

// Cancel it (works whether it is still queued or already running)
await broker.cancel('send-email', id);

// Bring a cancelled job back, or remove it entirely
await broker.resume('send-email', id);
await broker.deleteJob('send-email', id);

// Schedule a recurring job programmatically
await broker.schedule('cleanup', '0 0 * * *', { olderThan: 30 });

// Remove a schedule
await broker.unschedule('cleanup');
```

## Cancelling jobs

`broker.cancel(name, id)` requests cancellation of a job **whatever state it is in**:

- A job that is still **queued** is marked cancelled and never picked up by a worker.
- A job that is **already running** is asked to stop. Cancellation is _cooperative_: the runner detects the cancellation and aborts the `AbortSignal` passed to the job's `run(payload, signal)`. Handlers must honor the signal (forward it to `fetch`/DB calls, or check `signal.aborted`) to actually stop. **A handler that ignores the signal runs to completion** — Node cannot forcibly terminate it.

Cancellation works **across processes**. `cancel` records the state change on the shared PostgreSQL row, and whichever worker process is running the job observes it. That observation is done by polling: while a job runs, `PgBossJobRunner` periodically looks the job up (via pg-boss `findJobs`) and aborts the signal once the state becomes `cancelled` (or the job is deleted). The poll cadence is configurable:

```typescript
const runner = container.get(JobRunner) as PgBossJobRunner;
runner.cancelPollIntervalSeconds = 2; // default 5; set to 0 to disable polling
```

Lower values reduce cancellation latency at the cost of one extra lookup query per running job per interval.

## Retry & dead-letter policy

By default a job that keeps failing is retried a couple of times and then marked `failed` — where it stays, with nothing draining it. For money-critical or webhook work you usually want an explicit retry budget, backoff between attempts, and a **dead-letter queue (DLQ)** so a job that exhausts its retries is preserved for inspection or replay instead of being dropped.

Declare a `JobQueuePolicy` on the registration, right where the job is mapped. Every field is optional, and durations are Luxon `Duration`s (mapped to whole seconds for pg-boss):

```typescript
import { Duration } from 'luxon';

registry.set('deliver-webhook', {
  job: DeliverWebhookJob,
  policy: {
    retryLimit: 5, // attempts before the job is failed / dead-lettered
    retryDelay: Duration.fromObject({ seconds: 30 }), // base delay between attempts
    retryBackoff: true, // grow the delay exponentially (with jitter) from retryDelay
    retryDelayMax: Duration.fromObject({ minutes: 10 }), // cap for the backoff curve
    expiresIn: Duration.fromObject({ minutes: 2 }), // a run is considered stuck after this
    deadLetter: 'deliver-webhook-dead', // where exhausted jobs land
  },
});
```

The policy is applied to the queue when `runner.start()` runs: an absent queue is **created** with these options, and an existing queue is **updated** to match, so changing a policy and restarting reconciles it. When a registration declares no policy, its queue is created exactly as before — this feature is fully backward-compatible.

**Dead-letter queues are auto-created.** If `deadLetter` names a queue that does not yet exist, the runner creates it (as a plain queue) before the source queue that references it, so you don't have to register a placeholder. A DLQ you actually want to *drain* is just another registered job whose name matches — give it its own handler (and, if you like, its own policy). A DLQ you only want to inspect can be left unregistered; jobs simply accumulate there for manual review or redrive.

To apply the same defaults to **every** queue without repeating them, set `defaultQueuePolicy` on the runner. Each queue's own policy is layered on top, so a field a queue sets wins over the default:

```typescript
const runner = container.get(JobRunner) as PgBossJobRunner;
runner.defaultQueuePolicy = {
  retryLimit: 3,
  retryBackoff: true,
  retryDelay: Duration.fromObject({ seconds: 10 }),
};
await runner.start();
```

Retry and dead-letter behavior is a **queue-level** concern here, not a per-`send` one: it is declared once where the job is registered rather than on each `broker.send(...)`. This matches how the mainstream backends model it (pg-boss `retryLimit`/`deadLetter`, SQS's redrive policy, Cloud Tasks' `maxAttempts`), none of which support per-message retry overrides — so `JobQueuePolicy` stays portable across backends.

## Monitoring & draining dead-letter queues

Capturing a poison message is only half the job: a consumer needs to see what landed in a dead-letter queue and act on it. `JobMonitor` is the operator-side companion to `JobBroker` (produce) and `JobRunner` (consume) — it reads queue depth, lists the stuck jobs, and remediates them. Unlike the broker, it operates on **any queue name and does not require the queue to be registered**, because a dead-letter queue is often an unregistered sink with no worker of its own.

```typescript
const monitor = container.get(JobMonitor);

// Observe — poll depth/health (e.g. from a reconciliation cron) to alert on a growing DLQ
const stats = await monitor.getQueueStats('deliver-webhook-dead');
// stats: { name, queued, active, failed, total } | null (null when the queue does not exist)

if (stats && stats.total > 0) {
  // Retrieve — inspect the poison messages (id, state, original payload)
  const stuck = await monitor.listJobs<WebhookPayload>('deliver-webhook-dead');
  logger.warn(`${stuck.length} webhooks in the dead-letter queue`, { ids: stuck.map(j => j.id) });

  // Act — move them back to their original source queue to reprocess, oldest first, rate-limited
  const moved = await monitor.redrive('deliver-webhook-dead', { limit: 100 });

  // ...or discard a specific unrecoverable message
  await monitor.deleteJob('deliver-webhook-dead', stuck[0].id);
}
```

| Method                                                              | Description                                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `getQueueStats(name)`                                               | Point-in-time `{ name, queued, active, failed, total }`, or `null` if the queue does not exist. |
| `listJobs<P>(name, options?)`                                       | List retained jobs as `JobInfo<P>[]`; filter by `id`, partial `data`, or `queuedOnly`.          |
| `redrive(name, options?)`                                           | Move dead-lettered jobs back to their source (or a `destination`), oldest first; returns count. |
| `deleteJob(name, id)`                                               | Permanently discard one or more jobs (no registry check, so DLQ sinks are serviceable).         |
| `retryJob(name, id)`                                                | Re-attempt failed jobs **in place**; for a DLQ sink prefer `redrive`, which moves them to a worker. |

`redrive` returns each job to the queue it was dead-lettered from by default, so a worker can process it again. Pass `destination` to funnel everything into one queue, `sourceName` to drain just one source's jobs from a shared DLQ, and `limit` to move in controlled batches. All operations source their pg-boss `db` executor from `PgBossConnectionProvider`, so a remediation can run inside a transaction when you override the provider (see [Transactional enqueue](#transactional-enqueue)).

### Backend portability

`cancel`, `resume`, `deleteJob`, and `getJob` are best-effort by contract: a backend that cannot honor an operation throws `NotSupportedError` rather than silently doing nothing. `JobState` (`created | retry | active | completed | cancelled | failed`) is the normalized, lowest-common-denominator lifecycle; alternative backends map their native states to the nearest value. The bundled pg-boss backend supports every operation.

`send`'s `startAfter` is deliberately expressed as *intent* (a relative `Duration` or an absolute `DateTime`), not a wire format, so it maps cleanly onto each backend's native deferral mechanism — pg-boss `startAfter` (unbounded), SQS `DelaySeconds` (max 15 minutes), Cloud Tasks `scheduleTime` (up to 30 days). A backend that cannot honor a requested delay (e.g. an SQS backend asked for a 1-hour delay) throws `NotSupportedError` rather than clamping silently.

## API Reference

### `Job<Payload>`

Abstract base class for job handlers.

| Method                                                       | Description                                                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `run(payload: Payload, signal?: AbortSignal): Promise<void>` | Execute the job. `signal` is aborted on cancellation/shutdown; honoring it is optional. |

### `JobBroker`

Abstract base class for sending, cancelling, and inspecting jobs. Operations a backend cannot honor throw `NotSupportedError`.

| Method                                                                | Description                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `send<P>(name: string, payload: P, options?: JobSendOptions): Promise<string>` | Queue a job; resolves with the new job id. Pass `options.startAfter` (a Luxon `Duration` or `DateTime`) to defer it |
| `schedule<P>(name: string, cron: string, payload?: P): Promise<void>` | Create a recurring job schedule                                    |
| `unschedule(name: string): Promise<void>`                             | Remove a recurring job schedule                                    |
| `cancel(name: string, id: string \| string[]): Promise<void>`         | Request cancellation of queued or running jobs (cooperative)       |
| `resume(name: string, id: string \| string[]): Promise<void>`         | Re-queue previously cancelled jobs                                 |
| `deleteJob(name: string, id: string \| string[]): Promise<void>`      | Permanently delete jobs                                            |
| `getJob<P>(name: string, id: string): Promise<JobInfo<P> \| null>`    | Look up a job's current state, or `null` if it does not exist      |

### `JobInfo<Payload>` / `JobState`

Backend-agnostic snapshot returned by `getJob`. `JobInfo` has `id`, `name`, `state`, and `data`. `JobState` is one of `created`, `retry`, `active`, `completed`, `cancelled`, or `failed`.

### `JobRunner`

Abstract base class for processing jobs from the queue.

| Method                   | Description                |
| ------------------------ | -------------------------- |
| `start(): Promise<void>` | Start processing jobs      |
| `stop(): Promise<void>`  | Gracefully stop processing |

### `JobMonitor`

Abstract base class for observing queues and remediating dead-letter queues. Operates on raw queue names (no registry check). Operations a backend cannot honor throw `NotSupportedError`. See [Monitoring & draining dead-letter queues](#monitoring--draining-dead-letter-queues).

| Method                                                                     | Description                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `getQueueStats(name: string): Promise<JobQueueStats \| null>`              | Queue depth/health counts, or `null` if the queue does not exist                |
| `listJobs<P>(name: string, options?: JobQueryOptions): Promise<JobInfo<P>[]>` | List retained jobs, optionally filtered by `id`, `data`, or `queuedOnly`      |
| `redrive(name: string, options?: JobRedriveOptions): Promise<number>`      | Move dead-lettered jobs back to source (or a `destination`); returns count moved |
| `deleteJob(name: string, id: string \| string[]): Promise<void>`           | Permanently discard jobs                                                        |
| `retryJob(name: string, id: string \| string[]): Promise<void>`            | Re-attempt failed jobs in place                                                 |

`JobQueueStats` is `{ name, queued, active, failed, total }`. `JobQueryOptions` is `{ id?, data?, queuedOnly? }`. `JobRedriveOptions` is `{ destination?, sourceName?, limit? }`.

### `PgBossJobRegistryMap`

A `Map<string, Identifier<Job> | PgBossJobRegistration>` for registering jobs.

Entries can be either:

- A job class identifier (for on-demand jobs)
- A `PgBossJobRegistration` object (for scheduled jobs, jobs with a queue policy, or both)

### `PgBossJobRegistration`

Configuration object for a job. Only `job` is required, so it covers on-demand jobs (`{ job }`), scheduled jobs (`{ job, cron }`), and either with a retry/dead-letter policy attached.

| Property | Type              | Description                                                          |
| -------- | ----------------- | ------------------------------------------------------------------- |
| `job`    | `Identifier<Job>` | The job class identifier to instantiate when the job runs.          |
| `cron`   | `string`          | Optional cron expression defining when the job should run.          |
| `policy` | `JobQueuePolicy`  | Optional per-queue retry and dead-letter policy for the job's queue. |

### `JobQueuePolicy`

Backend-agnostic per-queue retry and dead-letter policy (see [Retry & dead-letter policy](#retry--dead-letter-policy)). Every field is optional; durations are Luxon `Duration`s.

| Property        | Type       | Description                                                                             |
| --------------- | ---------- | --------------------------------------------------------------------------------------- |
| `retryLimit`    | `number`   | Attempts before a job is failed (and dead-lettered, if `deadLetter` is set).            |
| `retryDelay`    | `Duration` | Delay before retrying; the base of the curve when `retryBackoff` is on.                 |
| `retryBackoff`  | `boolean`  | Grow the retry delay exponentially (with jitter) from `retryDelay` instead of fixed.    |
| `retryDelayMax` | `Duration` | Upper bound on the backoff delay. Only used when `retryBackoff` is on.                  |
| `expiresIn`     | `Duration` | How long a run may take before it is considered stuck and made eligible for retry.      |
| `deadLetter`    | `string`   | Name of the dead-letter queue that receives jobs which exhaust their retries.           |

### `PgBossJobBroker`

Concrete `JobBroker` implementation backed by pg-boss. Constructor signature: `new PgBossJobBroker(registrations: PgBossJobRegistryMap, pgboss: PgBoss, connectionProvider: PgBossConnectionProvider)`. Every operation sources its pg-boss `db` executor from the injected `PgBossConnectionProvider`. Typically resolved through the DI container rather than instantiated directly.

### `PgBossConnectionProvider`

Supplies the pg-boss `db` executor used when enqueuing or scheduling jobs.

| Method                        | Description                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `executor(): Db \| undefined` | The executor to run job-insert SQL against; `undefined` uses pg-boss's own pool. |

The default implementation returns `undefined`, so pg-boss uses its own connection pool (standard, non-transactional behavior). Override it on a request-scoped DI container to return a transaction-bound executor and enqueue jobs atomically with the surrounding database transaction — see [Transactional enqueue](#transactional-enqueue).

## Transactional enqueue

By default a job row is inserted on pg-boss's own connection, so it commits independently of any database work happening in the same request. To make an enqueue commit (or roll back) together with your business writes, override `PgBossConnectionProvider` in the request scope so its `executor()` returns the active transaction's connection. pg-boss ships adapters for the common query builders (`fromKysely`, `fromKnex`, `fromDrizzle`, `fromPrisma`) that wrap a transaction into the executor shape pg-boss expects:

```typescript
import { fromKysely } from 'pg-boss';
import { PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';

class TransactionalConnectionProvider extends PgBossConnectionProvider {
  constructor(private readonly trx: Transaction<DB>) {
    super();
  }

  override executor() {
    return fromKysely(this.trx);
  }
}

// Inside a transaction, bind the provider on the scoped container before resolving the broker:
await repository.withTransaction(async trx => {
  scopedContainer.override(PgBossConnectionProvider, new TransactionalConnectionProvider(trx));

  await doBusinessWrites(trx);
  await scopedContainer.get(JobBroker).send('send-email', { to: 'user@example.com' });
  // The job row and the business writes commit together.
});
```

### `PgBossJobRunner`

Concrete `JobRunner` implementation backed by pg-boss. Constructor signature: `new PgBossJobRunner(container: Container, registrations: PgBossJobRegistryMap, pgboss: PgBoss, logger: Logger)`. Calls `pgboss.start()` during `start()` and `pgboss.stop()` during `stop()`. Job instances are resolved from the DI container on each invocation. Typically resolved through the DI container rather than instantiated directly.

Exposes a `cancelPollIntervalSeconds` property (default `5`) that controls how often a running job is polled for cancellation; set it to `0` to disable polling. See [Cancelling jobs](#cancelling-jobs).

Also exposes an optional `defaultQueuePolicy` (a `JobQueuePolicy`) applied beneath every queue's own policy, so all queues can share retry/dead-letter defaults without repeating them. See [Retry & dead-letter policy](#retry--dead-letter-policy).

### `PgBossJobMonitor`

Concrete `JobMonitor` implementation backed by pg-boss. Constructor signature: `new PgBossJobMonitor(pgboss: PgBoss, connectionProvider: PgBossConnectionProvider)`. Reads and remediates queues via pg-boss's `getQueue`, `findJobs`, `redrive`, `deleteJob`, and `retry`, sourcing the `db` executor from the injected `PgBossConnectionProvider` (so remediation can be transactional). Does not consult the job registry, so it works on unregistered dead-letter sinks. Typically resolved through the DI container rather than instantiated directly.

## Graceful Shutdown

Ensure you stop the runner during application shutdown:

```typescript
process.on('SIGTERM', async () => {
  await runner.stop(); // Stops pg-boss internally
  process.exit(0);
});
```

## Peer Dependencies

- `pg-boss` ^12.5.4 - PostgreSQL-based job queue
- `reflect-metadata` - Required by InjectKit for decorator metadata

## License

MIT
