---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate a background job class with typed payload and JobBroker integration
argument-hint: <name> [file]
---

# /job - Generate Background Job

Generate a background job class file with payload typing and registration patterns.

## Arguments

1. `name` (required): Job name in PascalCase (e.g., `SendEmailJob`, `ProcessPaymentJob`)
2. `file` (optional): Output file path (defaults to `src/jobs/<name>.job.ts`)

## What This Skill Does

1. Creates a complete job file with:
   - Job class extending `Job<Payload>`
   - Typed payload interface
   - @Injectable decorator for dependency injection
   - run() method implementation scaffold
   - Registration example in comments
   - Both on-demand and scheduled job patterns

## Examples

Generate email job:
```
/job SendEmail
```

Generate job at specific path:
```
/job ProcessPayment src/jobs/payments/process-payment.job.ts
```

## Implementation Pattern

The generated job will follow this pattern:

```typescript
import { Job } from '@maroonedsoftware/jobbroker';
import { Injectable } from 'injectkit';

interface {Name}JobPayload {
  // TODO: Define payload properties
}

/**
 * {Name} Job
 *
 * @description TODO: Describe what this job does
 */
@Injectable()
export class {Name}Job extends Job<{Name}JobPayload> {
  constructor() {
    super('{job-name}');
  }

  async run(payload: {Name}JobPayload): Promise<void> {
    // TODO: Implement job logic
    console.log('Running {name} job', payload);
  }
}

// Usage example:
//
// Register the job:
// const job = container.get({Name}Job);
// await jobBroker.register(job);
//
// Queue on-demand:
// await jobBroker.enqueue('{job-name}', { /* payload */ });
//
// Schedule recurring:
// await jobBroker.schedule('{job-name}', '*/15 * * * *', { /* payload */ });
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract name (PascalCase) and file (optional)
   - Ensure name ends with "Job" (add if missing)
   - If no file specified, derive from name: `src/jobs/{kebab-case-name}.job.ts`

2. **Generate job file:**
   - Import Job from '@maroonedsoftware/jobbroker'
   - Import Injectable from 'injectkit'
   - Create payload interface with TODO comments
   - Create job class with @Injectable decorator
   - Extend Job<PayloadType>
   - Add constructor that calls super with job name (kebab-case)
   - Add async run() method with payload parameter
   - Include JSDoc documentation

3. **Job naming:**
   - Class name: PascalCase (e.g., SendEmailJob)
   - Job identifier: kebab-case (e.g., 'send-email')
   - File name: kebab-case with .job.ts suffix

4. **Add usage comments:**
   - Show how to register the job with JobBroker
   - Show how to enqueue on-demand
   - Show how to schedule recurring
   - Include cron expression example

5. **Include helpful patterns:**
   - Show how to inject dependencies in constructor
   - Show how to use logger
   - Show error handling pattern
   - Show retry configuration

6. **Write file:**
   - Create the complete job file
   - Ensure proper formatting

7. **Confirm to user:**
   - Show the file path where job was created
   - Show the job class name and identifier
   - Provide registration example
