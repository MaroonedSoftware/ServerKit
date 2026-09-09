import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';
import { AUDIT_SINK_FAILED_EVENT, AuditOptions, AuditRecorder } from '../../src/audit/audit.recorder.js';
import { AuditSink, CompositeAuditSink, LoggingAuditSink, NoopAuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';

const makeLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() }) as unknown as Logger;

/** A sink that keeps what it was given, so tests can assert on the stamped event. */
const makeSink = () => {
  const events: AuthenticationAuditEvent[] = [];
  const sink = { events, record: vi.fn(async (event: AuthenticationAuditEvent) => void events.push(event)) };
  return sink as unknown as AuditSink & typeof sink;
};

const makeFailingSink = (message = 'store is down') =>
  ({
    record: vi.fn(async () => {
      throw new Error(message);
    }),
  }) as unknown as AuditSink;

const event = { type: 'session.created', category: 'session', outcome: 'success', actorId: 'user-1' } as const;

let logger: Logger;

beforeEach(() => {
  vi.clearAllMocks();
  logger = makeLogger();
});

describe('AuditRecorder', () => {
  it('stamps occurredAt and passes the event through', async () => {
    const sink = makeSink();
    const before = DateTime.utc();

    await new AuditRecorder(sink, new AuditOptions(), logger).record(event);

    expect(sink.events).toHaveLength(1);
    const [recorded] = sink.events;
    expect(recorded).toMatchObject({ type: 'session.created', category: 'session', outcome: 'success', actorId: 'user-1' });
    expect(recorded!.occurredAt.isValid).toBe(true);
    expect(recorded!.occurredAt >= before).toBe(true);
  });

  it('stamps the time itself so a sink cannot forge or omit it', async () => {
    const sink = makeSink();
    // A caller passing occurredAt does not get to choose it.
    await new AuditRecorder(sink, new AuditOptions(), logger).record({ ...event, occurredAt: DateTime.fromISO('2000-01-01T00:00:00Z') } as never);

    expect(sink.events[0]!.occurredAt.year).toBe(DateTime.utc().year);
  });

  it('drops events when no sink is registered', async () => {
    // The default path for a consumer who has not opted in.
    await expect(new AuditRecorder().record(event)).resolves.toBeUndefined();
  });

  it('swallows a sink failure and logs it so the outage is monitorable', async () => {
    const recorder = new AuditRecorder(makeFailingSink(), new AuditOptions(), logger);

    // An audit store outage must not become a login outage.
    await expect(recorder.record(event)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(AUDIT_SINK_FAILED_EVENT, { type: 'session.created', error: 'store is down' });
  });

  it('rethrows a sink failure in strict mode', async () => {
    const recorder = new AuditRecorder(makeFailingSink(), new AuditOptions(true), logger);

    // Strict: an action that could not be recorded does not happen.
    await expect(recorder.record(event)).rejects.toThrow('store is down');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('survives a sink failure with no logger bound', async () => {
    await expect(new AuditRecorder(makeFailingSink()).record(event)).resolves.toBeUndefined();
  });

  it('reports a non-Error throw without crashing', async () => {
    const sink = {
      record: vi.fn(async () => {
        throw 'plain string';
      }),
    } as unknown as AuditSink;

    await expect(new AuditRecorder(sink, new AuditOptions(), logger).record(event)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(AUDIT_SINK_FAILED_EVENT, expect.objectContaining({ error: 'plain string' }));
  });
});

describe('NoopAuditSink', () => {
  it('accepts an event and does nothing', () => {
    expect(new NoopAuditSink().record()).toBeUndefined();
  });
});

describe('LoggingAuditSink', () => {
  it('logs a success at info with the type as the message', () => {
    const sink = new LoggingAuditSink(logger);

    const data = { sessionToken: 'st', factors: [], claims: {}, expiresAt: '2026-01-02T04:04:05.000Z' };
    sink.record({ ...event, occurredAt: DateTime.fromISO('2026-01-02T03:04:05Z', { zone: 'utc' }), data });

    expect(logger.info).toHaveBeenCalledWith('session.created', {
      category: 'session',
      outcome: 'success',
      occurredAt: '2026-01-02T03:04:05.000Z',
      actorId: 'user-1',
      data,
    });
  });

  it('logs a failure at warn', () => {
    const sink = new LoggingAuditSink(logger);

    sink.record({ type: 'api_key.rejected', category: 'machine', outcome: 'failure', occurredAt: DateTime.utc(), data: { reason: 'expired' } });

    expect(logger.warn).toHaveBeenCalledWith('api_key.rejected', expect.objectContaining({ outcome: 'failure' }));
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('omits absent optional fields rather than logging undefined', () => {
    new LoggingAuditSink(logger).record({ type: 'session.created', category: 'session', outcome: 'success', occurredAt: DateTime.utc() });

    const [, meta] = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(Object.keys(meta as object)).toEqual(['category', 'outcome', 'occurredAt']);
  });
});

describe('CompositeAuditSink', () => {
  it('offers the event to every member', async () => {
    const first = makeSink();
    const second = makeSink();

    await new CompositeAuditSink(first, second).record({ ...event, occurredAt: DateTime.utc() });

    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
  });

  it('still records to healthy members when one throws', async () => {
    const healthy = makeSink();
    const composite = new CompositeAuditSink(makeFailingSink(), healthy);

    // A broken SIEM must not cost you the database row.
    await expect(composite.record({ ...event, occurredAt: DateTime.utc() })).rejects.toThrow('store is down');
    expect(healthy.events).toHaveLength(1);
  });

  it('rethrows a single failure as itself', async () => {
    const composite = new CompositeAuditSink(makeFailingSink('only one'));

    await expect(composite.record({ ...event, occurredAt: DateTime.utc() })).rejects.toThrow('only one');
  });

  it('aggregates several failures', async () => {
    const composite = new CompositeAuditSink(makeFailingSink('a'), makeFailingSink('b'), makeSink());

    // Rethrowing keeps the recorder's failure policy meaningful; swallowing here
    // would hide an outage from strict mode and from the sink_failed log alike.
    await expect(composite.record({ ...event, occurredAt: DateTime.utc() })).rejects.toThrow(AggregateError);
  });

  it('is silent when it has no members', async () => {
    await expect(new CompositeAuditSink().record({ ...event, occurredAt: DateTime.utc() })).resolves.toBeUndefined();
  });

  it('reaches the recorder failure policy through the composite', async () => {
    const healthy = makeSink();
    const recorder = new AuditRecorder(new CompositeAuditSink(makeFailingSink(), healthy), new AuditOptions(), logger);

    await expect(recorder.record(event)).resolves.toBeUndefined();
    expect(healthy.events).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(AUDIT_SINK_FAILED_EVENT, expect.anything());
  });
});
