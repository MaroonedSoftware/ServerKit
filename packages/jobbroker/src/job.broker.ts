import { Injectable } from 'injectkit';
import { JobInfo } from './job.info.js';
import { JobScheduleOptions } from './job.schedule.options.js';
import { JobSendOptions } from './job.send.options.js';

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
 * // Deferring a job: run it no earlier than five minutes from now
 * await jobBroker.send('send-email', payload, {
 *   startAfter: Duration.fromObject({ minutes: 5 })
 * });
 *
 * // Deferring to an absolute time
 * await jobBroker.send('send-email', payload, {
 *   startAfter: DateTime.now().plus({ hours: 2 })
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
 * // Many schedules on one queue, each with its own key and time zone
 * await jobBroker.schedule('routine.run', 'FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=0', { routineId }, {
 *   key: routineId,
 *   timeZone: 'America/Chicago',
 * });
 *
 * // Removing a scheduled job
 * await jobBroker.unschedule('daily-report');
 * await jobBroker.unschedule('routine.run', routineId);
 * ```
 */
@Injectable()
export abstract class JobBroker {
  /**
   * Sends a job to the queue.
   *
   * By default the job is eligible for immediate processing and will be picked
   * up by a worker as soon as one is available. Pass {@link JobSendOptions.startAfter}
   * to defer it: the job becomes eligible only once the given delay has elapsed
   * (a {@link Duration}) or the given moment has passed (a {@link DateTime}).
   * Deferral is a lower bound, not a guarantee of exact-time execution — the job
   * runs at the first opportunity after it becomes eligible.
   *
   * @typeParam Payload - The type of the job payload. Must be an object.
   * @param name - The unique name identifying the job type.
   *               Must match a registered job handler.
   * @param payload - The data to pass to the job handler.
   * @param options - Optional enqueue options, e.g. `startAfter` to defer the job.
   * @returns A promise that resolves with the id of the queued job. The id can
   *          be passed to {@link cancel}, {@link resume}, {@link deleteJob}, or
   *          {@link getJob}.
   * @throws If the job name is not registered.
   * @throws `NotSupportedError` if `options.startAfter` requests a deferral the
   *         backend cannot honor (e.g. a delay beyond the backend's maximum).
   */
  abstract send<Payload extends object>(name: string, payload: Payload, options?: JobSendOptions): Promise<string>;

  /**
   * Schedules a recurring job.
   *
   * The job is enqueued automatically on every occurrence of `recurrence`. A job
   * name holds one schedule per {@link JobScheduleOptions.key}: scheduling again
   * with the same name and key replaces that schedule (its recurrence, payload,
   * zone and missed policy), and schedules under other keys are untouched.
   * Without a key the call targets the name's single unkeyed schedule.
   *
   * @typeParam Payload - The type of the job payload. Must be an object.
   * @param name - The unique name identifying the job type.
   *               Must match a registered job handler.
   * @param recurrence - A cron expression (e.g. `'0 9 * * *'` for daily at 09:00)
   *               or an RFC 5545 recurrence rule (e.g.
   *               `'FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=0'`).
   * @param payload - Optional data to pass to the job handler on each execution.
   * @param options - Optional key, time zone and missed-occurrence policy.
   * @returns A promise that resolves when the schedule has been created or replaced.
   * @throws If the job name is not registered, or the recurrence or time zone is invalid.
   * @throws `NotSupportedError` if the backend cannot honour the key, the time
   *         zone, the missed policy, or the recurrence's format.
   */
  abstract schedule<Payload extends object>(name: string, recurrence: string, payload?: Payload, options?: JobScheduleOptions): Promise<void>;

  /**
   * Removes a scheduled job.
   *
   * Stops the recurring execution of the schedule with the given name and key.
   * Does not affect jobs that are already queued, nor schedules under other keys.
   * Without a key, only the name's unkeyed schedule is removed. Removing a
   * schedule that does not exist is not an error.
   *
   * @param name - The name of the scheduled job.
   * @param key - The key the schedule was created with, if any.
   * @returns A promise that resolves when the schedule has been removed.
   * @throws If the job name is not registered.
   * @throws `NotSupportedError` if a key is given and the backend does not support keyed schedules.
   */
  abstract unschedule(name: string, key?: string): Promise<void>;

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
