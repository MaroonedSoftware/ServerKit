# @maroonedsoftware/jobbroker

A flexible background job processing library with support for scheduled and on-demand jobs. Currently ships with a [pg-boss](https://github.com/timgit/pg-boss) implementation for PostgreSQL-backed job queues.

## Features

- **Abstract interfaces** for easy testing and alternative implementations
- **Dependency injection** support via [injectkit](https://www.npmjs.com/package/injectkit)
- **Scheduled jobs** using cron expressions
- **On-demand jobs** for immediate execution
- **Cancellation** of queued _and_ running jobs, plus state lookup, delete, and resume
- **PostgreSQL backing** for reliability and transactional guarantees

## Installation

```bash
pnpm add @maroonedsoftware/jobbroker injectkit pg-boss reflect-metadata
```

> **Note:** InjectKit requires `reflect-metadata` to be imported at your application entry point and TypeScript configured with `experimentalDecorators: true` and `emitDecoratorMetadata: true`.

`pg-boss` is an optional peer dependency. The pg-boss backend lives behind a subpath export so importing the core (`@maroonedsoftware/jobbroker`) never loads it:

| Import                               | Contents                                                                                 | Pulls in      |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ------------- |
| `@maroonedsoftware/jobbroker`        | `Job`, `JobBroker`, `JobRunner`, `JobInfo`, `JobState`, `NotSupportedError`              | nothing extra |
| `@maroonedsoftware/jobbroker/pgboss` | `PgBossJobBroker`, `PgBossJobRunner`, `PgBossJobRegistryMap`, `PgBossConnectionProvider` | `pg-boss`     |

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
```

### 3. Set Up the Broker and Runner

```typescript
import 'reflect-metadata';
import { PgBoss } from 'pg-boss';
import { InjectKitRegistry } from 'injectkit';
import { ConsoleLogger, Logger } from '@maroonedsoftware/logger';
import { JobBroker, JobRunner } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker, PgBossJobRunner, PgBossJobRegistryMap, PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';

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

### Backend portability

`cancel`, `resume`, `deleteJob`, and `getJob` are best-effort by contract: a backend that cannot honor an operation throws `NotSupportedError` rather than silently doing nothing. `JobState` (`created | retry | active | completed | cancelled | failed`) is the normalized, lowest-common-denominator lifecycle; alternative backends map their native states to the nearest value. The bundled pg-boss backend supports every operation.

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
| `send<P>(name: string, payload: P): Promise<string>`                  | Queue a job for immediate processing; resolves with the new job id |
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

### `PgBossJobRegistryMap`

A `Map<string, Identifier<Job> | PgBossJobRegistration>` for registering jobs.

Entries can be either:

- A job class identifier (for on-demand jobs)
- A `PgBossJobRegistration` object with `job` and `cron` properties (for scheduled jobs)

### `PgBossJobRegistration`

Configuration object for a scheduled job.

| Property | Type              | Description                                                |
| -------- | ----------------- | ---------------------------------------------------------- |
| `job`    | `Identifier<Job>` | The job class identifier to instantiate when the job runs. |
| `cron`   | `string`          | A cron expression defining when the job should run.        |

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
