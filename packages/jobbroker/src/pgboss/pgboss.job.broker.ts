import { PgBoss, type Schedule, type ScheduleOptions } from 'pg-boss';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { JobBroker } from '../job.broker.js';
import { JobInfo } from '../job.info.js';
import { JobSchedule } from '../job.schedule.js';
import { JobScheduleOptions, JobSchedulePreviewOptions } from '../job.schedule.options.js';
import { JobSendOptions } from '../job.send.options.js';
import { PgBossJobRegistryMap } from './pgboss.job.registration.js';
import { PgBossConnectionProvider } from './pgboss.connection.provider.js';

/**
 * PgBoss implementation of the {@link JobBroker} interface.
 *
 * This broker uses PostgreSQL (via pg-boss) as the backing queue for job
 * processing. It provides reliable, transactional job queuing with support
 * for recurring schedules on cron expressions or RFC 5545 recurrence rules,
 * many per queue when each has its own key.
 *
 * Each enqueue and schedule call sources its pg-boss `db` executor from the
 * injected {@link PgBossConnectionProvider}. The default provider returns
 * `undefined` (pg-boss uses its own pool), but a request-scoped override can
 * supply a transaction-bound executor so jobs are enqueued atomically with the
 * surrounding database transaction.
 *
 * @example
 * ```typescript
 * // Setup with dependency injection
 * const pgboss = new PgBoss('postgres://...');
 * const registry = new PgBossJobRegistryMap();
 * registry.set('send-email', SendEmailJob);
 *
 * const broker = new PgBossJobBroker(registry, pgboss, new PgBossConnectionProvider());
 *
 * // Send a job
 * await broker.send('send-email', {
 *   to: 'user@example.com',
 *   subject: 'Hello!'
 * });
 * ```
 */
@Injectable()
export class PgBossJobBroker extends JobBroker {
  /**
   * Creates a new PgBossJobBroker instance.
   *
   * @param registrations - The registry map containing all registered jobs.
   * @param pgboss - The pg-boss instance to use for queue operations.
   * @param connectionProvider - Supplies the pg-boss `db` executor for each
   *        enqueue/schedule; the default returns `undefined` (pg-boss's own
   *        pool), while a request-scoped override enables transactional enqueue.
   */
  constructor(
    private readonly registrations: PgBossJobRegistryMap,
    private readonly pgboss: PgBoss,
    private readonly connectionProvider: PgBossConnectionProvider,
  ) {
    super();
  }

  /**
   * Sends a job to the PgBoss queue.
   *
   * The job-insert SQL runs against the executor returned by the injected
   * {@link PgBossConnectionProvider}; when that executor is bound to an active
   * transaction, the job is enqueued atomically with that transaction.
   *
   * When `options.startAfter` is supplied the job is deferred via pg-boss's
   * native `startAfter`, which imposes no upper bound on the delay: a
   * {@link Duration} is converted to a relative number of seconds and a
   * {@link DateTime} to an absolute `Date`.
   *
   * When `options.group` is supplied it is passed through as pg-boss's `group`
   * job option, so a worker's `groupConcurrency` can limit how many jobs of that
   * group run at once.
   *
   * @typeParam Payload - The type of the job payload.
   * @param name - The name of the registered job to execute.
   * @param payload - The data to pass to the job handler.
   * @param options - Optional enqueue options, e.g. `startAfter` to defer the job or `group` to group it.
   * @returns A promise that resolves with the id of the queued job.
   * @throws Error if the job name is not found in the registry.
   * @throws Error if pg-boss does not return a job id (e.g. the job was
   *         deduplicated away by a singleton policy).
   */
  async send<Payload extends object>(name: string, payload: Payload, options?: JobSendOptions): Promise<string> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    const id = await this.pgboss.send(name, payload, {
      db: this.connectionProvider.executor(),
      ...this.toStartAfter(options?.startAfter),
      ...(options?.group ? { group: options.group } : {}),
    });
    if (!id) {
      throw new Error(`Failed to enqueue job ${name}`);
    }

    return id;
  }

  /**
   * Maps a backend-agnostic `startAfter` intent onto pg-boss's native
   * `startAfter` option.
   *
   * A {@link Duration} becomes a relative number of seconds; a {@link DateTime}
   * becomes an absolute `Date`. Returns an empty object when no deferral was
   * requested so the field is simply omitted from the send options.
   */
  private toStartAfter(startAfter: JobSendOptions['startAfter']): { startAfter?: number | Date } {
    if (Duration.isDuration(startAfter)) {
      return { startAfter: startAfter.as('seconds') };
    }
    if (DateTime.isDateTime(startAfter)) {
      return { startAfter: startAfter.toJSDate() };
    }
    return {};
  }

  /**
   * Schedules a recurring job on a cron expression or an RFC 5545 recurrence rule.
   *
   * pg-boss decides the format from the expression itself and stores one row
   * per job name and key, so scheduling again with the same name and key
   * replaces that row. The options map onto pg-boss's own: `key` to `key`,
   * `timeZone` to `tz`, and `missed` to `missed`. pg-boss validates the
   * recurrence and the zone before writing and throws on either.
   *
   * The schedule-insert SQL runs against the executor returned by the injected
   * {@link PgBossConnectionProvider}; when that executor is bound to an active
   * transaction, the schedule commits or rolls back with it.
   *
   * @typeParam Payload - The type of the job payload.
   * @param name - The name of the registered job to schedule.
   * @param recurrence - A cron expression or an RFC 5545 recurrence rule.
   * @param payload - Optional data to pass to the job on each execution.
   * @param options - Optional key, time zone and missed-occurrence policy.
   * @returns A promise that resolves when the schedule has been created or replaced.
   * @throws Error if the job name is not found in the registry.
   * @throws Error if pg-boss rejects the recurrence, the time zone or the key.
   */
  async schedule<Payload extends object>(name: string, recurrence: string, payload?: Payload, options?: JobScheduleOptions): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.schedule(name, recurrence, payload, {
      db: this.connectionProvider.executor(),
      ...this.toScheduleOptions(options),
    });
  }

  /**
   * Maps backend-agnostic schedule options onto pg-boss's `key`, `tz` and
   * `missed`, leaving out any that were not given so pg-boss applies its own
   * defaults (the unkeyed schedule, UTC, and `skip`).
   */
  private toScheduleOptions(options: JobScheduleOptions | undefined): Pick<ScheduleOptions, 'key' | 'tz' | 'missed'> {
    return {
      ...(options?.key !== undefined && { key: options.key }),
      ...(options?.timeZone !== undefined && { tz: options.timeZone }),
      ...(options?.missed !== undefined && { missed: options.missed }),
    };
  }

  /**
   * Removes a scheduled job from pg-boss.
   *
   * This stops future executions of the schedule with the given name and key.
   * Jobs that are already queued will still be processed. pg-boss reads a
   * missing key as the empty key, so `unschedule(name)` removes only the
   * unkeyed schedule and leaves keyed ones in place.
   *
   * The delete runs against the executor returned by the injected
   * {@link PgBossConnectionProvider}, so inside a transaction it rolls back
   * with the transaction.
   *
   * @param name - The name of the scheduled job.
   * @param key - The key the schedule was created with, if any.
   * @returns A promise that resolves when the schedule has been removed.
   * @throws Error if the job name is not found in the registry.
   */
  async unschedule(name: string, key?: string): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.unschedule(name, key, { db: this.connectionProvider.executor() });
  }

  /**
   * Lists the schedules on a job name from pg-boss.
   *
   * With a key this reads the one row by its primary key. Without one it pages
   * through every schedule on the name, so a queue with many keyed schedules is
   * returned whole rather than cut off at pg-boss's page size.
   *
   * pg-boss offers no connection option for this read, so it always runs on
   * pg-boss's own pool: a schedule written inside a transaction that has not
   * committed yet is not visible here.
   *
   * @typeParam Payload - The type of the scheduled payload.
   * @param name - The name of the registered job.
   * @param key - When given, only the schedule with this key.
   * @returns A promise that resolves with the matching schedules, ordered by key.
   * @throws Error if the job name is not found in the registry.
   */
  async getSchedules<Payload extends object>(name: string, key?: string): Promise<JobSchedule<Payload>[]> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    if (key !== undefined) {
      const schedule = await this.pgboss.getSchedule(name, key);
      return schedule ? [this.toJobSchedule<Payload>(schedule)] : [];
    }

    const schedules: Schedule[] = [];
    let after: Pick<Schedule, 'name' | 'key'> | undefined;
    for (;;) {
      const page = await this.pgboss.getSchedules(name, undefined, { limit: PgBossJobBroker.schedulePageSize, ...(after && { after }) });
      schedules.push(...page);
      const last = page.at(-1);
      if (page.length < PgBossJobBroker.schedulePageSize || !last) {
        break;
      }
      after = { name: last.name, key: last.key };
    }

    return schedules.map(schedule => this.toJobSchedule<Payload>(schedule));
  }

  /** Rows read per page when {@link getSchedules} lists every schedule on a name. */
  private static readonly schedulePageSize = 1000;

  /** Maps a pg-boss schedule row onto the backend-agnostic {@link JobSchedule}. */
  private toJobSchedule<Payload extends object>(schedule: Schedule): JobSchedule<Payload> {
    return {
      name: schedule.name,
      key: schedule.key,
      recurrence: schedule.cron,
      timeZone: schedule.timezone || 'UTC',
      ...(schedule.data != null && { payload: schedule.data as Payload }),
    };
  }

  /**
   * Computes the next occurrences of a recurrence with pg-boss's
   * `previewSchedule`, which validates exactly as {@link schedule} does and
   * touches neither the database nor the schedule table.
   *
   * `from` defaults to pg-boss's reading of database time, which on an instance
   * that runs schedules accounts for clock skew against the database. The
   * returned `DateTime`s are in `options.timeZone`, or UTC when omitted.
   *
   * @param recurrence - A cron expression or an RFC 5545 recurrence rule.
   * @param options - Optional time zone, starting point and count.
   * @returns A promise that resolves with the occurrences, earliest first.
   * @throws Error if pg-boss rejects the recurrence, the time zone or the count.
   */
  async previewSchedule(recurrence: string, options?: JobSchedulePreviewOptions): Promise<DateTime[]> {
    const zone = options?.timeZone ?? 'UTC';
    const occurrences = this.pgboss.previewSchedule(recurrence, {
      tz: zone,
      ...(options?.from !== undefined && { from: options.from.toJSDate() }),
      ...(options?.count !== undefined && { count: options.count }),
    });

    return occurrences.map(occurrence => DateTime.fromJSDate(occurrence, { zone }));
  }

  /**
   * Cancels one or more jobs in the PgBoss queue.
   *
   * pg-boss marks the job(s) as `cancelled` in PostgreSQL. This works whether a
   * job is still queued or already running: a queued job is never picked up,
   * while a running job is observed as cancelled by the {@link PgBossJobRunner}
   * (which polls for the state change and aborts the handler's `AbortSignal`).
   * Interrupting a running handler is cooperative — see {@link Job.run}.
   *
   * @param name - The name of the registered job to cancel.
   * @param id - A single job id, or an array of ids, to cancel.
   * @returns A promise that resolves once the cancellation has been requested.
   * @throws Error if the job name is not found in the registry.
   */
  async cancel(name: string, id: string | string[]): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.cancel(name, id, { db: this.connectionProvider.executor() });
  }

  /**
   * Resumes one or more previously cancelled jobs, re-queuing them for processing.
   *
   * Only jobs currently in the `cancelled` state are affected.
   *
   * @param name - The name of the registered job to resume.
   * @param id - A single job id, or an array of ids, to resume.
   * @returns A promise that resolves once the jobs have been re-queued.
   * @throws Error if the job name is not found in the registry.
   */
  async resume(name: string, id: string | string[]): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.resume(name, id, { db: this.connectionProvider.executor() });
  }

  /**
   * Permanently deletes one or more jobs from the PgBoss queue.
   *
   * @param name - The name of the registered job to delete.
   * @param id - A single job id, or an array of ids, to delete.
   * @returns A promise that resolves once the jobs have been deleted.
   * @throws Error if the job name is not found in the registry.
   */
  async deleteJob(name: string, id: string | string[]): Promise<void> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    await this.pgboss.deleteJob(name, id, { db: this.connectionProvider.executor() });
  }

  /**
   * Looks up the current state of a single job.
   *
   * @typeParam Payload - The type of the job payload.
   * @param name - The name of the registered job to look up.
   * @param id - The id of the job to look up.
   * @returns A promise that resolves with the {@link JobInfo} for the job, or
   *          `null` if no job with that id exists.
   * @throws Error if the job name is not found in the registry.
   */
  async getJob<Payload extends object>(name: string, id: string): Promise<JobInfo<Payload> | null> {
    if (!this.registrations.has(name)) {
      throw new Error(`Job ${name} is not registered`);
    }

    const [job] = await this.pgboss.findJobs<Payload>(name, { id, db: this.connectionProvider.executor() });
    if (!job) {
      return null;
    }

    return { id: job.id, name: job.name, state: job.state, data: job.data };
  }
}
