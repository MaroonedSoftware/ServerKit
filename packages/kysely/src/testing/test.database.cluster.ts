import { randomUUID } from 'node:crypto';
import pg from 'pg';

/** How old a run must be before another run may sweep it, and only if its beacon is gone too. */
const DEFAULT_STALE_RUN_MS = 60 * 60 * 1000;

/** Postgres silently truncates a longer identifier, which would make two clones collide. */
const MAX_NAME_LENGTH = 63;

/** Options for {@link TestDatabaseCluster}. */
export interface TestDatabaseClusterOptions {
  /** A connection to any database on the test cluster, as a role that can create databases. */
  adminUrl: string;
  /** Starts every database this makes, so runs of different apps can share a cluster. Letters, digits and `_`. */
  prefix: string;
  /** How old an abandoned run must be before it is swept. Defaults to one hour. */
  staleRunMs?: number;
}

/** One test run's template. Its id is what workers pass to {@link TestDatabaseCluster.clone}. */
export interface TestDatabaseRun {
  id: string;
  /** Drops the template and everything cloned from it, and ends the run. */
  finish: () => Promise<void>;
}

/** A database cloned for one test file. */
export interface TestDatabaseClone {
  name: string;
  url: string;
  drop: () => Promise<void>;
}

/**
 * The whole of a name this class generates, after the prefix: a run id (eight base-36 digits of
 * start time, eight hex digits) then the template or a clone. Anchored, because the sweep drops what
 * matches, and a database that merely starts with the prefix may belong to someone else.
 */
const GENERATED_NAME = /^(([0-9a-z]{8})_[0-9a-f]{8})_(?:template|\w*_[0-9a-f]{8})$/;

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const escapedLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');

/**
 * Gives each test file its own database, cloned from a template built once per run.
 *
 * A clone takes milliseconds where migrating takes seconds, so every file can write freely without
 * seeing another's rows. Every database carries its run's id, so several runs (other worktrees, a
 * watch session) can share one cluster. A run holds a connection open for its whole life as a beacon:
 * a crashed run's databases are swept by the next run, once they are old and the beacon has gone,
 * and a run that is merely slow is never swept from under itself.
 *
 * Framework-neutral. Call {@link startRun} from a global setup, hand the run's id to workers however
 * the runner allows, and call {@link clone} per file. The template is rebuilt each run, not migrated
 * forward, because a migration tool skips a migration it has already applied, so one edited in place
 * would otherwise leave the suite on the old schema.
 *
 * @example
 * ```typescript
 * import { TestDatabaseCluster } from '@maroonedsoftware/kysely/testing';
 *
 * const cluster = new TestDatabaseCluster({ adminUrl, prefix: 'myapp_test' });
 *
 * // Global setup:
 * const run = await cluster.startRun(async templateUrl => migrate(templateUrl));
 * project.provide('testRunId', run.id);
 * return run.finish;
 *
 * // Per test file:
 * const database = await cluster.clone(inject('testRunId'), import.meta.url);
 * afterAll(database.drop);
 * ```
 */
export class TestDatabaseCluster {
  private readonly adminUrl: string;
  private readonly prefix: string;
  private readonly staleRunMs: number;

  constructor(options: TestDatabaseClusterOptions) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(options.prefix)) {
      throw new Error(`Invalid test database prefix: ${options.prefix}`);
    }
    this.adminUrl = options.adminUrl;
    this.prefix = `${options.prefix}_`;
    this.staleRunMs = options.staleRunMs ?? DEFAULT_STALE_RUN_MS;
  }

  /**
   * Sweeps abandoned runs, then builds this run's template.
   *
   * @param prepare - Migrates the empty template. Close any connection you open: a template with a
   *   connection on it cannot be cloned.
   * @returns The run, whose `finish` belongs in the global teardown.
   */
  async startRun(prepare: (templateUrl: string) => Promise<void>): Promise<TestDatabaseRun> {
    const id = `${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    const beacon = new pg.Client({ connectionString: this.adminUrl, application_name: `${this.prefix}${id}`.slice(0, MAX_NAME_LENGTH) });
    await beacon.connect();

    const template = this.template(id);
    try {
      await this.sweepStaleRuns();
      await this.admin(client => client.query(`create database ${quoted(template)}`));
      await prepare(this.urlOf(template));
      await this.admin(client => client.query(`alter database ${quoted(template)} is_template true`));
    } catch (error) {
      // A half-built template is left for the sweep: no teardown runs when setup throws.
      await beacon.end();
      throw error;
    }

    return {
      id,
      finish: async () => {
        try {
          await this.dropRun(id);
        } finally {
          await beacon.end();
        }
      },
    };
  }

  /**
   * Clones the run's template.
   *
   * @param runId - {@link TestDatabaseRun.id}.
   * @param label - What the clone is for, such as `import.meta.url`. Only used to read the name.
   * @returns The clone.
   */
  async clone(runId: string, label: string): Promise<TestDatabaseClone> {
    const start = `${this.prefix}${runId}_`;
    const suffix = `_${randomUUID().slice(0, 8)}`;
    const readable = label
      .replace(/^.*\//, '')
      .replace(/\W+/g, '_')
      .slice(0, Math.max(0, MAX_NAME_LENGTH - start.length - suffix.length));
    const name = `${start}${readable}${suffix}`;

    await this.admin(client => client.query(`create database ${quoted(name)} template ${quoted(this.template(runId))}`));
    return {
      name,
      url: this.urlOf(name),
      drop: () => this.admin(client => client.query(`drop database if exists ${quoted(name)} with (force)`)).then(() => undefined),
    };
  }

  private template(runId: string): string {
    return `${this.prefix}${runId}_template`;
  }

  private urlOf(name: string): string {
    const url = new URL(this.adminUrl);
    url.pathname = `/${name}`;
    return url.toString();
  }

  private async admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: this.adminUrl });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  private async dropRun(runId: string): Promise<void> {
    await this.admin(async client => {
      const like = `${escapedLike(`${this.prefix}${runId}_`)}%`;
      const { rows } = await client.query<{ datname: string }>(`select datname from pg_database where datname like $1 escape '\\'`, [like]);
      for (const { datname } of rows) {
        if (GENERATED_NAME.exec(datname.slice(this.prefix.length))?.[1] !== runId) continue;
        await client.query(`alter database ${quoted(datname)} is_template false`);
        await client.query(`drop database if exists ${quoted(datname)} with (force)`);
      }
    });
  }

  private async sweepStaleRuns(): Promise<void> {
    const like = `${escapedLike(this.prefix)}%`;
    const runs = await this.admin(async client => {
      const databases = await client.query<{ datname: string }>(`select datname from pg_database where datname like $1 escape '\\'`, [like]);
      const live = await client.query<{ application_name: string }>(
        `select distinct application_name from pg_stat_activity where application_name like $1 escape '\\'`,
        [like],
      );
      const liveRuns = new Set(live.rows.map(row => row.application_name.slice(this.prefix.length)));
      const stale = new Set<string>();
      for (const { datname } of databases.rows) {
        const [, id, started] = GENERATED_NAME.exec(datname.slice(this.prefix.length)) ?? [];
        if (id === undefined || started === undefined || liveRuns.has(id)) continue;
        if (Date.now() - Number.parseInt(started, 36) > this.staleRunMs) stale.add(id);
      }
      return stale;
    });

    for (const id of runs) {
      await this.dropRun(id);
    }
  }
}
