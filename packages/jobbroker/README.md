# @maroonedsoftware/jobbroker

A flexible background job processing library with support for scheduled and on-demand jobs. Currently ships with a [pg-boss](https://github.com/timgit/pg-boss) implementation for PostgreSQL-backed job queues.

## Features

- **Abstract interfaces** for easy testing and alternative implementations
- **Dependency injection** support via [injectkit](https://www.npmjs.com/package/injectkit)
- **Scheduled jobs** using cron expressions
- **On-demand jobs** for immediate execution
- **PostgreSQL backing** for reliability and transactional guarantees

## Installation

```bash
pnpm add @maroonedsoftware/jobbroker injectkit pg-boss reflect-metadata
```

> **Note:** InjectKit requires `reflect-metadata` to be imported at your application entry point and TypeScript configured with `experimentalDecorators: true` and `emitDecoratorMetadata: true`.

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

  async run(payload: EmailPayload): Promise<void> {
    await this.emailService.send(payload.to, payload.subject, payload.body);
  }
}
```

### 2. Register Jobs

Create a registry and register your jobs:

```typescript
import { PgBossJobRegistryMap } from '@maroonedsoftware/jobbroker';

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
import { PgBossJobBroker, PgBossJobRunner, PgBossJobRegistryMap, JobBroker, JobRunner } from '@maroonedsoftware/jobbroker';

// Initialize pg-boss
const pgboss = new PgBoss('postgres://user:pass@localhost/mydb');
await pgboss.start();

// Set up dependency injection registry
const diRegistry = new InjectKitRegistry();

diRegistry.register(PgBossJobRegistryMap).useInstance(registry);
diRegistry.register(PgBoss).useInstance(pgboss);
diRegistry.register(JobBroker).useClass(PgBossJobBroker).asSingleton();
diRegistry.register(JobRunner).useClass(PgBossJobRunner).asSingleton();

// Build the container
const container = diRegistry.build();

// Start the job runner
const runner = container.get(JobRunner);
await runner.start();
```

### 4. Send Jobs

Use the broker to queue jobs for processing:

```typescript
const broker = container.get(JobBroker);

// Send an immediate job
await broker.send('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up.',
});

// Schedule a recurring job programmatically
await broker.schedule('cleanup', '0 0 * * *', { olderThan: 30 });

// Remove a schedule
await broker.unschedule('cleanup');
```

## API Reference

### `Job<Payload>`

Abstract base class for job handlers.

| Method                                 | Description                            |
| -------------------------------------- | -------------------------------------- |
| `run(payload: Payload): Promise<void>` | Execute the job with the given payload |

### `JobBroker`

Abstract interface for sending jobs to the queue.

| Method                                                                | Description                          |
| --------------------------------------------------------------------- | ------------------------------------ |
| `send<P>(name: string, payload: P): Promise<void>`                    | Queue a job for immediate processing |
| `schedule<P>(name: string, cron: string, payload?: P): Promise<void>` | Create a recurring job schedule      |
| `unschedule(name: string): Promise<void>`                             | Remove a recurring job schedule      |

### `JobRunner`

Abstract interface for processing jobs from the queue.

| Method                   | Description                |
| ------------------------ | -------------------------- |
| `start(): Promise<void>` | Start processing jobs      |
| `stop(): Promise<void>`  | Gracefully stop processing |

### `PgBossJobRegistryMap`

A `Map<string, Identifier<Job> | PgBossJobRegistration>` for registering jobs.

Entries can be either:

- A job class identifier (for on-demand jobs)
- A `PgBossJobRegistration` object with `job` and `cron` properties (for scheduled jobs)

## Graceful Shutdown

Ensure you stop the runner during application shutdown:

```typescript
process.on('SIGTERM', async () => {
  await runner.stop();
  await pgboss.stop();
  process.exit(0);
});
```

## Peer Dependencies

- `pg-boss` ^12.5.4 - PostgreSQL-based job queue
- `reflect-metadata` - Required by InjectKit for decorator metadata

## License

MIT
