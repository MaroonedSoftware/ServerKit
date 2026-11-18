import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { DateTime } from 'luxon';
import { PgBoss, fromPglite, type Db } from 'pg-boss';
import { PgBossJobBroker } from '../../src/pgboss/pgboss.job.broker.js';
import { PgBossJobRegistryMap } from '../../src/pgboss/pgboss.job.registration.js';
import { PgBossConnectionProvider } from '../../src/pgboss/pgboss.connection.provider.js';
import { Job } from '../../src/job.js';

class RoutineJob extends Job<{ routineId: string }> {
  async run(): Promise<void> {}
}

/** Hands the broker a transaction-bound executor, the way a request-scoped override would. */
class FixedConnectionProvider extends PgBossConnectionProvider {
  constructor(private readonly db: Db) {
    super();
  }

  override executor(): Db {
    return this.db;
  }
}

const QUEUE = 'routine.run';

/**
 * Runs the broker against a real pg-boss over an in-process PGlite database, so
 * what is asserted is what pg-boss stores and validates, not what a mock was
 * handed.
 */
describe('PgBossJobBroker schedules against pg-boss', () => {
  let pglite: PGlite;
  let pgboss: PgBoss;
  let registrations: PgBossJobRegistryMap;
  let broker: PgBossJobBroker;

  const brokerOn = (trx: Transaction) => new PgBossJobBroker(registrations, pgboss, new FixedConnectionProvider(fromPglite(trx)));

  beforeAll(async () => {
    pglite = new PGlite();
    pgboss = new PgBoss({ db: fromPglite(pglite), backend: 'pglite', schedule: false, supervise: false });
    pgboss.on('error', () => {});
    await pgboss.start();
    await pgboss.createQueue(QUEUE);

    registrations = new PgBossJobRegistryMap();
    registrations.set(QUEUE, RoutineJob);
    broker = new PgBossJobBroker(registrations, pgboss, new PgBossConnectionProvider());
  }, 60_000);

  afterAll(async () => {
    await pgboss?.stop({ graceful: false });
    await pglite?.close();
  });

  beforeEach(async () => {
    for (const schedule of await pgboss.getSchedules(QUEUE)) {
      await pgboss.unschedule(QUEUE, schedule.key);
    }
  });

  it('keeps two keys on one queue independent', async () => {
    await broker.schedule(QUEUE, '0 9 * * *', { routineId: 'a' }, { key: 'a' });
    await broker.schedule(QUEUE, '0 17 * * *', { routineId: 'b' }, { key: 'b' });

    const schedules = await pgboss.getSchedules(QUEUE);
    expect(schedules.map(s => [s.key, s.cron, s.data])).toEqual([
      ['a', '0 9 * * *', { routineId: 'a' }],
      ['b', '0 17 * * *', { routineId: 'b' }],
    ]);

    await broker.unschedule(QUEUE, 'a');

    const remaining = await pgboss.getSchedules(QUEUE);
    expect(remaining.map(s => s.key)).toEqual(['b']);
  });

  it('replaces a schedule scheduled again with the same key', async () => {
    await broker.schedule(QUEUE, '0 9 * * *', { routineId: 'a' }, { key: 'a', timeZone: 'Europe/Paris' });
    await broker.schedule(QUEUE, 'FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=8;BYMINUTE=30', { routineId: 'a2' }, { key: 'a', timeZone: 'Asia/Tokyo' });

    const schedules = await pgboss.getSchedules(QUEUE);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      key: 'a',
      kind: 'rrule',
      cron: 'FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=8;BYMINUTE=30',
      timezone: 'Asia/Tokyo',
      data: { routineId: 'a2' },
    });
  });

  it('stores the time zone and missed policy', async () => {
    await broker.schedule(QUEUE, '0 9 * * 1-5', undefined, { key: 'tz', timeZone: 'America/Chicago', missed: 'once' });

    const schedule = await pgboss.getSchedule(QUEUE, 'tz');
    expect(schedule?.timezone).toBe('America/Chicago');
    expect(schedule?.options?.missed).toBe('once');
  });

  it('rolls back a schedule made inside a rolled-back transaction', async () => {
    await expect(
      pglite.transaction(async trx => {
        await brokerOn(trx).schedule(QUEUE, '0 9 * * *', undefined, { key: 'tx' });
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');

    expect(await pgboss.getSchedule(QUEUE, 'tx')).toBeNull();
  });

  it('rolls back an unschedule made inside a rolled-back transaction', async () => {
    await broker.schedule(QUEUE, '0 9 * * *', undefined, { key: 'tx' });

    await expect(
      pglite.transaction(async trx => {
        await brokerOn(trx).unschedule(QUEUE, 'tx');
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');

    expect(await pgboss.getSchedule(QUEUE, 'tx')).not.toBeNull();
  });

  it('commits a schedule and an unschedule made inside a committed transaction', async () => {
    await broker.schedule(QUEUE, '0 9 * * *', undefined, { key: 'gone' });

    await pglite.transaction(async trx => {
      const scoped = brokerOn(trx);
      await scoped.schedule(QUEUE, '0 10 * * *', undefined, { key: 'kept' });
      await scoped.unschedule(QUEUE, 'gone');
    });

    const schedules = await pgboss.getSchedules(QUEUE);
    expect(schedules.map(s => s.key)).toEqual(['kept']);
  });

  it('rejects an invalid cron expression', async () => {
    await expect(broker.schedule(QUEUE, 'not a cron', undefined, { key: 'bad' })).rejects.toThrow();
    expect(await pgboss.getSchedule(QUEUE, 'bad')).toBeNull();
  });

  it('rejects an invalid recurrence rule', async () => {
    await expect(broker.schedule(QUEUE, 'FREQ=SOMETIMES', undefined, { key: 'bad' })).rejects.toThrow();
    expect(await pgboss.getSchedule(QUEUE, 'bad')).toBeNull();
  });

  it('rejects an unknown time zone', async () => {
    await expect(broker.schedule(QUEUE, '0 9 * * *', undefined, { key: 'bad', timeZone: 'Mars/Olympus_Mons' })).rejects.toThrow();
    expect(await pgboss.getSchedule(QUEUE, 'bad')).toBeNull();
  });

  it('keeps unkeyed calls on the single unkeyed schedule', async () => {
    await broker.schedule(QUEUE, '0 9 * * *', undefined, { key: 'keyed' });
    await broker.schedule(QUEUE, '0 6 * * *');
    await broker.schedule(QUEUE, '0 7 * * *');

    const unkeyed = await pgboss.getSchedule(QUEUE);
    expect(unkeyed).toMatchObject({ key: '', cron: '0 7 * * *', timezone: 'UTC' });

    await broker.unschedule(QUEUE);

    const schedules = await pgboss.getSchedules(QUEUE);
    expect(schedules.map(s => s.key)).toEqual(['keyed']);
  });

  it('lists schedules through the broker', async () => {
    await broker.schedule(QUEUE, 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', { routineId: 'a' }, { key: 'a', timeZone: 'Europe/Paris' });
    await broker.schedule(QUEUE, '0 17 * * *', undefined, { key: 'b' });

    expect(await broker.getSchedules(QUEUE)).toEqual([
      { name: QUEUE, key: 'a', recurrence: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', timeZone: 'Europe/Paris', payload: { routineId: 'a' } },
      { name: QUEUE, key: 'b', recurrence: '0 17 * * *', timeZone: 'UTC' },
    ]);
    expect(await broker.getSchedules(QUEUE, 'b')).toEqual([{ name: QUEUE, key: 'b', recurrence: '0 17 * * *', timeZone: 'UTC' }]);
    expect(await broker.getSchedules(QUEUE, 'missing')).toEqual([]);
  });

  it('previews a weekly recurrence rule in a time zone', async () => {
    const from = DateTime.fromISO('2030-01-01T00:00:00', { zone: 'America/Chicago' });

    const occurrences = await broker.previewSchedule('FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=0', {
      timeZone: 'America/Chicago',
      from,
      count: 3,
    });

    expect(occurrences.map(o => o.toISO())).toEqual([
      '2030-01-02T09:00:00.000-06:00',
      '2030-01-07T09:00:00.000-06:00',
      '2030-01-09T09:00:00.000-06:00',
    ]);
  });

  it('previews a monthly recurrence rule across daylight saving', async () => {
    const from = DateTime.fromISO('2030-02-01T00:00:00', { zone: 'America/New_York' });

    const occurrences = await broker.previewSchedule('FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=8;BYMINUTE=0', {
      timeZone: 'America/New_York',
      from,
      count: 2,
    });

    expect(occurrences.map(o => o.toISO())).toEqual(['2030-02-15T08:00:00.000-05:00', '2030-03-15T08:00:00.000-04:00']);
  });

  it('rejects an invalid recurrence in a preview', async () => {
    await expect(broker.previewSchedule('FREQ=SOMETIMES')).rejects.toThrow();
    await expect(broker.previewSchedule('0 9 * * *', { timeZone: 'Mars/Olympus_Mons' })).rejects.toThrow();
  });
});
