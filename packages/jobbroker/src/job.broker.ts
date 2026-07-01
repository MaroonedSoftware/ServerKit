import { Injectable } from 'injectkit';
import { JobInfo } from './job.info.js';

/**
 * Abstract base class for job broker implementations.
 *
 * A job broker is responsible for sending jobs to a queue, cancelling and
 * inspecting jobs, and managing scheduled jobs. It provides the producer-side
 * interface for the job processing system.
 *
 * Backends differ in what they can do. Operations a backend cannot honor throw
 * a `NotSupportedError` rather than silently doing nothing. The bundled pg-boss
 * backend supports every operation.
 *
 * @example
 * ```typescript
 * // Sending a job immediately (returns the job id)
 * const id = await jobBroker.send('send-email', {
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   body: 'Thanks for signing up.'
 * });
 *
 * // Cancelling it later, whether it is still queued or already running
 * await jobBroker.cancel('send-email', id);
 *
 * // Scheduling a recurring job with cron
 * await jobBroker.schedule('daily-report', '0 9 * * *', {
 *   reportType: 'sales'
 * });
 *
 * // Removing a scheduled job
 * await jobBroker.unschedule('daily-report');
 * ```
 */
@Injectable()
export abstract class JobBroker {
  /**
   * Sends a job to the queue for immediate processing.
   *
   * The job will be picked up by a worker as soon as one is available.
   *
   * @typeParam Payload - The type of the job payload. Must be an object.
   * @param name - The unique name identifying the job type.
   *               Must match a registered job handler.
   * @param payload - The data to pass to the job handler.
   * @returns A promise that resolves with the id of the queued job. The id can
   *          be passed to {@link cancel}, {@link resume}, {@link deleteJob}, or
   *          {@link getJob}.
   * @throws If the job name is not registered.
   */
  abstract send<Payload extends object>(name: string, payload: Payload): Promise<string>;

  /**
   * Schedules a recurring job using a cron expression.
   *
   * The job will be automatically enqueued according to the cron schedule.
   * If a schedule already exists for this job name, it will be updated.
   *
   * @typeParam Payload - The type of the job payload. Must be an object.
   * @param name - The unique name identifying the job type.
   *               Must match a registered job handler.
   * @param cron - A cron expression defining the schedule (e.g., '0 9 * * *' for daily at 9am).
   * @param payload - Optional data to pass to the job handler on each execution.
   * @returns A promise that resolves when the schedule has been created.
   * @throws If the job name is not registered.
   */
  abstract schedule<Payload extends object>(name: string, cron: string, payload?: Payload): Promise<void>;

  /**
   * Removes a scheduled job.
   *
   * Stops the recurring execution of the specified job.
   * Does not affect jobs that are already queued.
   *
   * @param name - The unique name of the scheduled job to remove.
   * @returns A promise that resolves when the schedule has been removed.
   * @throws If the job name is not registered.
   */
  abstract unschedule(name: string): Promise<void>;

  /**
   * Requests cancellation of one or more jobs.
   *
   * Cancellation is best-effort and applies regardless of the job's state: a
   * job that is still queued is prevented from running, and a job that is
   * already running is asked to stop. For a running job, cancellation is
   * cooperative — the job's handler receives an aborted `AbortSignal` (see
   * {@link Job.run}) and must honor it. A handler that ignores the signal runs
   * to completion. Some backends may forcefully terminate the running compute
   * instead; this contract only guarantees the request is delivered.
   *
   * @param name - The name of the registered job type.
   * @param id - A single job id, or an array of ids, to cancel.
   * @returns A promise that resolves once the cancellation has been requested.
   * @throws If the job name is not registered.
   * @throws `NotSupportedError` if the backend cannot cancel jobs.
   */
  abstract cancel(name: string, id: string | string[]): Promise<void>;

  /**
   * Resumes one or more previously cancelled jobs, re-queuing them for processing.
   *
   * Only jobs in the `cancelled` state can be resumed; other states are
   * unaffected.
   *
   * @param name - The name of the registered job type.
   * @param id - A single job id, or an array of ids, to resume.
   * @returns A promise that resolves once the jobs have been re-queued.
   * @throws If the job name is not registered.
   * @throws `NotSupportedError` if the backend cannot resume jobs.
   */
  abstract resume(name: string, id: string | string[]): Promise<void>;

  /**
   * Permanently deletes one or more jobs.
   *
   * Removes the job records entirely. Unlike {@link cancel}, a deleted job
   * leaves no `cancelled` record behind and cannot be resumed.
   *
   * @param name - The name of the registered job type.
   * @param id - A single job id, or an array of ids, to delete.
   * @returns A promise that resolves once the jobs have been deleted.
   * @throws If the job name is not registered.
   * @throws `NotSupportedError` if the backend cannot delete jobs.
   */
  abstract deleteJob(name: string, id: string | string[]): Promise<void>;

  /**
   * Looks up the current state of a single job.
   *
   * @typeParam Payload - The type of the job payload.
   * @param name - The name of the registered job type.
   * @param id - The id of the job to look up.
   * @returns A promise that resolves with the {@link JobInfo} for the job, or
   *          `null` if no job with that id exists.
   * @throws If the job name is not registered.
   * @throws `NotSupportedError` if the backend cannot report per-job state.
   */
  abstract getJob<Payload extends object>(name: string, id: string): Promise<JobInfo<Payload> | null>;
}
