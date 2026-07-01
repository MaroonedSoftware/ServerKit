/**
 * The lifecycle state of a job, normalized across backends.
 *
 * These are the lowest-common-denominator states that a job broker can report.
 * Backends map their native states to the nearest value here:
 *
 * - `created` — enqueued and waiting to be picked up by a worker.
 * - `retry` — failed at least once and waiting to be retried.
 * - `active` — currently being executed by a worker.
 * - `completed` — finished successfully.
 * - `cancelled` — cancelled before or during execution (see {@link JobBroker.cancel}).
 * - `failed` — finished unsuccessfully after exhausting retries.
 *
 * Not every backend can express every state. A backend that lacks per-job state
 * tracking may be unable to implement {@link JobBroker.getJob} at all and should
 * throw a `NotSupportedError` instead of guessing.
 */
export type JobState = 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';

/**
 * A backend-agnostic snapshot of a single job.
 *
 * Returned by {@link JobBroker.getJob}. It deliberately exposes only the fields
 * every supported backend can provide, so callers can reason about jobs without
 * coupling to a specific queue implementation (pg-boss, a future AWS/GCP backend, etc.).
 *
 * @typeParam Payload - The type of the job payload.
 */
export interface JobInfo<Payload extends object = object> {
  /** The unique identifier of the job, as returned by {@link JobBroker.send}. */
  id: string;
  /** The name of the job type (the queue the job belongs to). */
  name: string;
  /** The current lifecycle {@link JobState} of the job. */
  state: JobState;
  /** The payload the job was enqueued with. */
  data: Payload;
}
