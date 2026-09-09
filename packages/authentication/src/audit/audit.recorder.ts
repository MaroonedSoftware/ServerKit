import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';
import { AuditSink, NoopAuditSink } from './audit.sink.js';
import type { AuditEventInput, AuthenticationAuditEvent } from './types.js';

/** Event logged when a sink throws and {@link AuditOptions.strict} is off. */
export const AUDIT_SINK_FAILED_EVENT = 'audit.sink_failed' as const;

/** Configuration for {@link AuditRecorder}. */
@Injectable()
export class AuditOptions {
  constructor(
    /**
     * Whether a sink failure aborts the operation being audited.
     *
     * `false` (the default) catches, logs {@link AUDIT_SINK_FAILED_EVENT} at
     * `error`, and lets the operation continue: an audit store outage must not
     * become a login outage. Alert on that event, or the outage is invisible.
     *
     * `true` rethrows, so an action that could not be recorded does not happen.
     * That is what some compliance regimes require, and it means a sink outage
     * *is* a login outage. Choose deliberately.
     */
    public readonly strict: boolean = false,
  ) {}
}

/**
 * Stamps events and hands them to the {@link AuditSink}, applying the failure
 * policy in one place.
 *
 * Services inject the recorder rather than the sink, so that eleven services do
 * not each reimplement the try/catch, and so the strict/lenient decision lives
 * at a single point.
 *
 * Every service takes it as a **defaulted trailing constructor parameter**:
 *
 * ```ts
 * constructor(
 *   private readonly repository: PasswordFactorRepository,
 *   // …
 *   private readonly audit: AuditRecorder = new AuditRecorder(),
 * ) {}
 * ```
 *
 * That is what makes audit non-breaking: a consumer who has not registered
 * anything keeps their existing constructor calls, and the default recorder
 * drops every event.
 */
@Injectable()
export class AuditRecorder {
  constructor(
    private readonly sink: AuditSink = new NoopAuditSink(),
    private readonly options: AuditOptions = new AuditOptions(),
    private readonly logger?: Logger,
  ) {}

  /**
   * Stamp an event with the current time and record it.
   *
   * @param event - The event without `occurredAt`.
   * @throws Whatever the sink threw, but only when {@link AuditOptions.strict}
   *   is set. Otherwise a sink failure is logged and swallowed.
   */
  async record(event: AuditEventInput): Promise<void> {
    // Stamped here, not in the sink, so every event shares one clock and a sink
    // cannot forge or omit the time.
    const stamped = { ...event, occurredAt: DateTime.utc() } as AuthenticationAuditEvent;

    try {
      await this.sink.record(stamped);
    } catch (error) {
      if (this.options.strict) throw error;

      this.logger?.error(AUDIT_SINK_FAILED_EVENT, {
        type: stamped.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
