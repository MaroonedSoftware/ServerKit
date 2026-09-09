import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { AuthenticationAuditEvent } from './types.js';

/**
 * Where audit events go.
 *
 * Implement it against your store and register the concrete class under this
 * abstract one, which doubles as the DI token. Nothing else in the package needs
 * changing: every service already emits, through
 * {@link import('./audit.recorder.js').AuditRecorder}, and an unbound sink is a
 * no-op.
 *
 * ```ts
 * @Injectable()
 * class DatabaseAuditSink extends AuditSink {
 *   constructor(private readonly rows: AuditRepository) { super(); }
 *   async record(event: AuthenticationAuditEvent) { await this.rows.insert(event); }
 * }
 *
 * registry.register(AuditSink).useClass(DatabaseAuditSink).asSingleton();
 * registry.register(AuditRecorder).useClass(AuditRecorder).asSingleton();
 * ```
 *
 * **Throwing is meaningful.** By default the recorder catches, logs
 * `audit.sink_failed`, and lets the operation continue, so a store outage cannot
 * take down login. Set `AuditOptions.strict` when an unauditable action must not
 * proceed instead. Either way, do not swallow errors inside your own `record` —
 * that hides the outage from both policies.
 *
 * **Do not do slow work here.** `record` is awaited inside the operation being
 * audited. Enqueue and return rather than writing across a network on the login
 * path.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface AuditSink {
  /**
   * Record one event.
   *
   * @param event - The event, already stamped with `occurredAt`.
   */
  record(event: AuthenticationAuditEvent): Promise<void> | void;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class AuditSink implements AuditSink {}

/**
 * Discards every event.
 *
 * The default when no sink is registered, which is what makes audit emission
 * additive: a consumer that has not opted in sees no behaviour change and pays
 * only a method call per event.
 */
@Injectable()
export class NoopAuditSink extends AuditSink {
  record(): void {}
}

/**
 * Writes events through a {@link Logger}.
 *
 * The sensible first sink for an application with no audit store yet, and a
 * useful second one alongside a database when the operator wants events in the
 * log stream too.
 *
 * Matches the event convention the package already uses in its own logging: the
 * dotted type is the message and the structured fields are the metadata, so
 * `api_key.created` reads identically whether it came from here or from
 * `ApiKeyService`'s own line. A `failure` outcome logs at `warn`; everything
 * else at `info`.
 */
@Injectable()
export class LoggingAuditSink extends AuditSink {
  constructor(private readonly logger: Logger) {
    super();
  }

  record(event: AuthenticationAuditEvent): void {
    const { type, category, outcome, occurredAt, actorId, context, data } = event;
    const meta = {
      category,
      outcome,
      occurredAt: occurredAt.toISO(),
      ...(actorId === undefined ? {} : { actorId }),
      ...(context === undefined ? {} : { context }),
      ...(data === undefined ? {} : { data }),
    };

    if (outcome === 'failure') this.logger.warn(type, meta);
    else this.logger.info(type, meta);
  }
}

/**
 * Fans one event out to several sinks.
 *
 * Every member is offered the event even when an earlier one throws, so a broken
 * SIEM does not cost you the database row. Failures are collected and rethrown
 * together as an `AggregateError` once all members have run, which keeps the
 * recorder's failure policy meaningful — swallowing here would hide an outage
 * from strict mode as well as from the `audit.sink_failed` log.
 */
@Injectable()
export class CompositeAuditSink extends AuditSink {
  private readonly sinks: ReadonlyArray<AuditSink>;

  constructor(...sinks: AuditSink[]) {
    super();
    this.sinks = sinks;
  }

  async record(event: AuthenticationAuditEvent): Promise<void> {
    const failures: unknown[] = [];

    for (const sink of this.sinks) {
      try {
        await sink.record(event);
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `${failures.length} audit sinks failed to record ${event.type}`);
  }
}
