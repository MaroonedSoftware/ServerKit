/**
 * Options controlling a recurring schedule created by {@link JobBroker.schedule}.
 *
 * Like {@link JobSendOptions}, these describe intent rather than a particular
 * backend's wire format. A backend that cannot honour one of them throws a
 * `NotSupportedError` rather than silently ignoring it (see {@link JobBroker}).
 */
export interface JobScheduleOptions {
  /**
   * Distinguishes this schedule from the others on the same job name.
   *
   * A job name holds one schedule per key, so a single queue can carry many
   * independent schedules (one per user, per tenant, per routine) by giving
   * each its own key. Scheduling again with a key that already exists replaces
   * that schedule and leaves the others alone.
   *
   * When omitted, the schedule is the job name's single unkeyed schedule, which
   * is what a call without options has always created.
   */
  key?: string;

  /**
   * The IANA time zone the recurrence is evaluated in (e.g. `America/Chicago`).
   *
   * A daily `0 9 * * *` with `timeZone: 'Europe/Paris'` fires at 09:00 Paris
   * time, tracking daylight saving. When omitted, the recurrence is evaluated
   * in UTC. An unknown zone is rejected when the schedule is created.
   */
  timeZone?: string;

  /**
   * What to do about occurrences that came due while nothing was running to
   * send them, such as during a deploy or an outage.
   *
   * - `'skip'` sends nothing for them and waits for the next occurrence.
   * - `'once'` sends a single job for the most recent missed occurrence, however
   *   many were missed.
   *
   * When omitted, the backend's default applies (`'skip'` for pg-boss).
   */
  missed?: 'skip' | 'once';
}
