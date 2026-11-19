import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Duration } from 'luxon';
import { PgBoss, fromPglite } from 'pg-boss';
import { Injectable, InjectKitRegistry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '../../src/pgboss/pgboss.job.broker.js';
import { PgBossJobRunner } from '../../src/pgboss/pgboss.job.runner.js';
import { PgBossJobRegistryMap } from '../../src/pgboss/pgboss.job.registration.js';
import { PgBossConnectionProvider } from '../../src/pgboss/pgboss.connection.provider.js';
import { registerJobContext } from '../../src/job.context.js';
import { Job } from '../../src/job.js';

type Payload = { group: string; label: string };

/** Jobs that have started and not yet been released, in start order. */
const running: Payload[] = [];
/** Every job that has finished. */
const finished: string[] = [];
/** The most jobs of one group seen running at the same moment. */
let maxPerGroup = 0;
let release: () => void = () => {};
const released = new Promise<void>(resolve => (release = resolve));

/** Holds every execution open until the test releases it, so overlap is observable. */
@Injectable()
class HeldJob extends Job<Payload> {
  async run(payload: Payload): Promise<void> {
    running.push(payload);
    maxPerGroup = Math.max(maxPerGroup, running.filter(p => p.group === payload.group).length);
    await released;
    running.splice(running.indexOf(payload), 1);
    finished.push(payload.label);
  }
}

const QUEUE = 'chat.reply';

/**
 * Runs the broker and the runner against a real pg-boss over an in-process
 * PGlite database, so the group limit asserted is the one pg-boss enforces
 * when fetching, not what a mock was handed.
 */
describe('PgBossJobRunner local group concurrency against pg-boss', () => {
  let pglite: PGlite;
  let pgboss: PgBoss;
  let runner: PgBossJobRunner;
  let broker: PgBossJobBroker;

  beforeAll(async () => {
    pglite = new PGlite();
    pgboss = new PgBoss({ db: fromPglite(pglite), backend: 'pglite', schedule: false, supervise: false });
    pgboss.on('error', () => {});

    const registry = new InjectKitRegistry();
    registerJobContext(registry);
    registry.register(HeldJob).useClass(HeldJob).asTransient();
    const container = registry.build();

    const registrations = new PgBossJobRegistryMap();
    registrations.set(QUEUE, {
      job: HeldJob,
      worker: { concurrency: 4, localGroupConcurrency: 1, pollInterval: Duration.fromObject({ milliseconds: 500 }) },
    });

    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;
    runner = new PgBossJobRunner(container, registrations, pgboss, logger);
    runner.cancelPollIntervalSeconds = 0;
    broker = new PgBossJobBroker(registrations, pgboss, new PgBossConnectionProvider());

    // The queue exists before the runner starts, so the test can queue jobs first.
    await pgboss.start();
    await pgboss.createQueue(QUEUE);
  }, 60_000);

  afterAll(async () => {
    release();
    await pgboss?.stop({ graceful: false });
    await pglite?.close();
  });

  it('runs jobs of one group one at a time while another group runs alongside', async () => {
    await broker.send(QUEUE, { group: 'a', label: 'a1' }, { group: { id: 'a' } });
    await broker.send(QUEUE, { group: 'a', label: 'a2' }, { group: { id: 'a' } });
    await broker.send(QUEUE, { group: 'b', label: 'b1' }, { group: { id: 'b' } });

    // Queued before any worker exists, so all four workers' first fetches go
    // for them at once, which is when concurrent fetches race on a real server.
    // PGlite runs one query at a time, so it cannot show that race, only that
    // the local limit holds.
    await runner.start();

    // One job from each group starts; the second job of group a stays queued.
    await vi.waitFor(() => expect(running).toHaveLength(2), { timeout: 10_000, interval: 50 });
    expect(running.map(p => p.group).sort()).toEqual(['a', 'b']);

    // Give the four workers several more polls to (wrongly) pick up a2.
    await new Promise(resolve => setTimeout(resolve, 1_500));
    expect(running).toHaveLength(2);

    release();
    await vi.waitFor(() => expect(finished.sort()).toEqual(['a1', 'a2', 'b1']), { timeout: 10_000, interval: 50 });
    expect(maxPerGroup).toBe(1);
  }, 30_000);
});
