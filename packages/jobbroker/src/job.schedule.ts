/**
 * A recurring schedule as stored by a {@link JobBroker}, returned by
 * {@link JobBroker.getSchedules}.
 *
 * Lowest common denominator across backends: what was scheduled, under which
 * key, on which recurrence and in which zone. Backend bookkeeping (row
 * timestamps, the last job a schedule created) is deliberately left out.
 *
 * @typeParam Payload - The type of the payload each scheduled job is sent with.
 */
export interface JobSchedule<Payload extends object = object> {
  /** The job name the schedule enqueues. */
  name: string;
  /** The key the schedule was created with; `''` for the name's unkeyed schedule. */
  key: string;
  /** The cron expression or RFC 5545 recurrence rule the schedule recurs on. */
  recurrence: string;
  /** The IANA time zone the recurrence is evaluated in, `'UTC'` when none was given. */
  timeZone: string;
  /** The payload each scheduled job is sent with, when one was given. */
  payload?: Payload;
}
