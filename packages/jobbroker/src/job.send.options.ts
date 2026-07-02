import { DateTime, Duration } from 'luxon';

/**
 * Options controlling how a single job is enqueued by {@link JobBroker.send}.
 *
 * The options here are deliberately backend-agnostic: they describe *intent*
 * ("run this no earlier than X"), not a particular queue's wire format. Each
 * backend maps them onto its native mechanism, and a backend that cannot honor
 * a requested option throws a `NotSupportedError` rather than silently ignoring
 * it (see {@link JobBroker}).
 */
export interface JobSendOptions {
  /**
   * Defer processing of the job until some point in the future.
   *
   * Accepts either form, so callers can express whichever they have naturally:
   *
   * - A Luxon {@link Duration} — a delay *relative* to now (e.g.
   *   `Duration.fromObject({ minutes: 5 })` runs the job no earlier than five
   *   minutes from enqueue time).
   * - A Luxon {@link DateTime} — an *absolute* earliest-run time (e.g.
   *   `DateTime.now().plus({ hours: 2 })`).
   *
   * When omitted, the job is eligible for immediate processing.
   *
   * Backends map this onto their native deferral mechanism (pg-boss
   * `startAfter`, SQS `DelaySeconds`, Cloud Tasks `scheduleTime`, …). Because
   * those mechanisms differ in range — SQS caps delays at 15 minutes, for
   * instance — a backend that cannot honor the requested delay throws a
   * `NotSupportedError`.
   */
  startAfter?: Duration | DateTime;
}
