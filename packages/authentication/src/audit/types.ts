import { DateTime } from 'luxon';

/**
 * Broad grouping for an audit event, so a consumer can route or retain by class
 * without matching on every {@link AuditEvent.type}.
 *
 * The first four are the categories a compliance auditor asks for by name:
 *
 * - `login` — an authentication attempt resolved, either way.
 * - `credential` — a credential was created, changed, or removed.
 * - `privilege` — what the subject may do changed: MFA enrolled or removed, a
 *   lockout cleared, an identity provider linked, a recovery grant issued.
 * - `session` — session lifecycle, distinct from the authentication that began it.
 * - `recovery` — the out-of-band account recovery flow.
 * - `machine` — a non-human credential acted.
 */
export type AuditEventCategory = 'login' | 'credential' | 'privilege' | 'session' | 'recovery' | 'machine';

/**
 * Whether the operation succeeded.
 *
 * `failure` always means a **credential verdict** — a wrong password, an expired
 * key, a replayed code. It never means an infrastructure fault: events are
 * emitted at the decision point rather than from a catch block, so a cache
 * outage or a mailer 503 produces no event at all rather than a false failure.
 * Without that rule an operator's audit feed fills up with their own downtime.
 */
export type AuditOutcome = 'success' | 'failure';

/**
 * Request-scoped detail an application attaches to an event.
 *
 * Every field is optional and **this package never fills any of them**. It has
 * no access to a request: it sits at L2 alongside the HTTP adapters, so it
 * cannot import `@maroonedsoftware/koa` or `@maroonedsoftware/fastify`, and the
 * dependency arrow would point the wrong way if it did.
 *
 * Fill them in your own {@link import('./audit.sink.js').AuditSink}, which the
 * application registers and can therefore scope to the request:
 *
 * ```ts
 * @Injectable()
 * class DatabaseAuditSink extends AuditSink {
 *   constructor(private readonly ctx: ServerKitContext, private readonly rows: AuditRepository) { super(); }
 *
 *   async record(event: AuthenticationAuditEvent) {
 *     await this.rows.insert({ ...event, context: { correlationId: this.ctx.correlationId, ipAddress: this.ctx.ip } });
 *   }
 * }
 * ```
 *
 * `correlationId` and `requestId` line up with `RequestIdentity` in
 * `@maroonedsoftware/servercore`, which every adapter's context middleware
 * resolves and echoes on the response.
 */
export interface AuditEventContext {
  /** Ties this event to the request and to work fanned out from it. */
  correlationId?: string;
  /** Identifies this one request. */
  requestId?: string;
  /** Caller's IP, when the application knows it. */
  ipAddress?: string;
  /** Caller's user agent, when the application knows it. */
  userAgent?: string;
}

/** Fields every audit event carries, whatever its type. */
export interface AuditEventBase {
  /** Dotted `<domain>.<action>` identifier, e.g. `'password.verify.failed'`. */
  type: string;
  /** Broad grouping, for routing and retention. */
  category: AuditEventCategory;
  /** Whether the operation succeeded. See {@link AuditOutcome}. */
  outcome: AuditOutcome;
  /**
   * When the event happened, stamped by
   * {@link import('./audit.recorder.js').AuditRecorder} so every event in a run
   * shares one clock.
   */
  occurredAt: DateTime;
  /**
   * The subject the event is about, when known.
   *
   * Absent only where the package genuinely does not know it — an unrecognised
   * API key, a JWT that failed to decode. Anything the package can attribute,
   * it does, so a consumer never has to look the actor up to file the record.
   */
  actorId?: string;
  /** Request-scoped detail, filled by the application's sink. */
  context?: AuditEventContext;
}

/**
 * One audit event: the common envelope plus a literal type and its own payload.
 *
 * Domains declare their events by instantiating this, which keeps the envelope
 * in one place and still gives a consumer a discriminated union to switch on:
 *
 * ```ts
 * export type SessionAuditEvent =
 *   | AuditEvent<'session.created', { sessionToken: string; factors: string[] }>
 *   | AuditEvent<'session.revoked', { sessionToken: string; reason: SessionRevocationReason }>;
 * ```
 */
export interface AuditEvent<TType extends string = string, TData = Record<string, unknown>> extends AuditEventBase {
  /** Dotted `<domain>.<action>` identifier. */
  type: TType;
  /**
   * Payload specific to this event type.
   *
   * **Never a secret.** No password, hash, token, OTP code, magic-link token,
   * recovery code, TOTP secret, or WebAuthn assertion reaches an event.
   * Identifiers, methods, reasons, and counts only. A key's `hint` is fine; its
   * token is not.
   */
  data?: TData;
}

/**
 * Every event this package emits.
 *
 * Grows one domain at a time. Consumers should `switch` on `type` with a
 * `default` branch, since a minor release may add a member.
 */
export type AuthenticationAuditEvent = AuditEvent;

/** `Omit` that distributes across a union instead of collapsing it to its common keys. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * What a service passes to {@link import('./audit.recorder.js').AuditRecorder.record}:
 * an event without its timestamp, which the recorder stamps.
 */
export type AuditEventInput = DistributiveOmit<AuthenticationAuditEvent, 'occurredAt'>;
