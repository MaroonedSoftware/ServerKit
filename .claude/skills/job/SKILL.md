---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate a background job for @maroonedsoftware/jobbroker, a Job subclass with a typed payload plus its PgBossJobRegistryMap entry and DI registration, run on demand or on a cron schedule
argument-hint: <name> [file]
---

# /job - Generate Background Job

Generate a background job class file with payload typing and registration patterns.

## Arguments

1. `name` (required): Job class name in PascalCase (e.g., `SendEmailJob`, `ProcessPaymentJob`)
2. `file` (optional): Output file path (defaults to `src/jobs/<name>.job.ts`, with the name in dot notation)

## What This Skill Does

1. Creates a complete job file with:
   - Job class extending `Job<Payload>`
   - Typed payload interface
   - @Injectable decorator for dependency injection
   - run() method implementation scaffold
2. Adds the job to the app's jobs module, or shows how:
   - An entry in `PgBossJobRegistryMap`, with the queue policy and worker policy if asked for
   - A DI registration of the job class
   - Both on-demand and scheduled patterns

## Examples

Generate email job:
```
/job SendEmail
```

Generate job at specific path:
```
/job ProcessPayment src/jobs/payments/process.payment.job.ts
```

## Implementation Pattern

The generated job will follow this pattern:

```typescript
import { Job } from '@maroonedsoftware/jobbroker';
import { Injectable } from 'injectkit';

export interface {Name}JobPayload {
  // TODO: Define payload properties
}

/**
 * {Name} Job
 *
 * @description TODO: Describe what this job does
 */
@Injectable()
export class {Name}Job extends Job<{Name}JobPayload> {
  // Add a constructor only for dependencies. It calls a bare super(): the job's name is not on the class.

  async run(payload: {Name}JobPayload, signal?: AbortSignal): Promise<void> {
    // TODO: Implement job logic. Forward `signal` to async work so cancellation can interrupt it.
  }
}

// Register it, inside the setup hook of the module that owns the jobs:
//
// jobs.set('{job.name}', {Name}Job);
// registry.register({Name}Job).useClass({Name}Job).asScoped();
//
// Queue on demand, from a service that injects JobBroker:
// const id = await broker.send('{job.name}', { /* payload */ });
//
// Schedule recurring, in the registry entry:
// jobs.set('{job.name}', { job: {Name}Job, cron: '*/15 * * * *' });
```

If the app has no jobs module yet, generate one. `examples/simple.job.example.ts` is the whole wiring:
`PgBoss`, `PgBossJobRegistryMap`, `PgBossConnectionProvider`, `JobBroker` bound to `PgBossJobBroker`,
`JobRunner` bound to `PgBossJobRunner`, with `JobRunner.start()` in the module's `start` hook and
`JobRunner.stop()` in its `shutdown` hook.

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract name (PascalCase) and file (optional)
   - Ensure name ends with "Job" (add if missing)
   - If no file specified, derive from name in dot notation: `SendEmailJob` becomes `src/jobs/send.email.job.ts`

2. **Generate job file:**
   - Import `Job` from `@maroonedsoftware/jobbroker`
   - Import `Injectable` from `injectkit`
   - Create payload interface with TODO comments. It must be an object type
   - Create job class with @Injectable decorator
   - Extend `Job<PayloadType>`
   - Add a constructor only if the job has dependencies. It calls `super()` with no arguments
   - Add async `run(payload, signal?)`
   - Include JSDoc documentation

3. **Job naming:**
   - Class name: PascalCase (e.g., `SendEmailJob`)
   - Job name: dot notation, chosen by the registry entry (e.g., `email.send`). It is a catalog key, so it never has a hyphen, and a dead-letter queue name follows the same rule
   - File name: dot notation with a `.job.ts` suffix

4. **Register the job in two places, or it does not run:**
   - `PgBossJobRegistryMap`: `jobs.set(name, JobClass)`, or `jobs.set(name, { job, cron, policy, worker })`
   - The DI registry: `registry.register(JobClass).useClass(JobClass).asScoped()`. The runner resolves the job from a fresh scope per execution
   - A name missing from the map makes `JobBroker.send` throw `Job <name> is not registered`

5. **Choose how it is triggered:**
   - On demand: `broker.send(name, payload, options?)` resolves with the job id. `options.startAfter` takes a Luxon `Duration` or `DateTime` to defer it
   - On a schedule, with no payload: a `cron` field in the registry entry. The job then receives `null` as its payload at runtime, so it must not read it
   - On a schedule, with a payload: `broker.schedule(name, cron, payload)` once the runner has started, instead of `cron`

6. **Handle failure deliberately:**
   - An ordinary thrown error counts as transient: the job retries under the queue's policy, then goes to the dead-letter queue if there is one
   - `throw new PermanentJobError(message)` when the input can never succeed. It skips the retries and dead-letters immediately
   - Retries are configured per queue in `policy` (`retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`, `expiresIn`, `deadLetter`). Durations are Luxon, not seconds. There is no per-send retry option
   - Worker concurrency goes in `worker` (`concurrency`, `batchSize`, `pollInterval`)

7. **Include helpful patterns:**
   - Inject dependencies through the constructor, including `Logger`. There is no `this.container` on a job
   - A service that needs to know which job it runs under injects `JobContext`, and the app must then call `registerJobContext(registry)` in `setup`
   - Use Luxon for time, never `new Date()`

8. **Write file:**
   - Create the complete job file
   - Ensure proper formatting

9. **Confirm to user:**
   - Show the file path where job was created
   - Show the job class name and job name
   - Show the two registration lines, and whether a jobs module still has to be created
