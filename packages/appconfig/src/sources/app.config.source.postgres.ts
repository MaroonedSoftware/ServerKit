import { Client, Pool } from 'pg';
import { ServerkitError } from '@maroonedsoftware/errors';
import type { AppConfigSource } from '../app.config.source.js';
import type { AppConfigResolver } from '../app.config.resolver.js';
import { resolveValues } from '../resolve.js';
import { tryParseJson } from '../helpers.js';
import { Logger } from '@maroonedsoftware/logger';

/**
 * Postgres connection parameters used by {@link AppConfigSourcePostgres}.
 *
 * Mirrors the subset of `pg`'s `ClientConfig` the source needs, supplied via the
 * `connection` variant of {@link AppConfigSourcePostgresSource}.
 */
export interface AppConfigSourcePostgresConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * How {@link AppConfigSourcePostgres} obtains its Postgres connection — exactly one of two modes:
 *
 * - **Owned connection** (`{ connection, resolvers? }`): the source opens and closes a
 *   short-lived `pg` {@link Client} per `load`/`get` (and a dedicated one for `watch`). String
 *   values in `connection` may contain `${env:…}` / `${aws:…}` / `${gcp:…}` references, which the
 *   supplied `resolvers` resolve *fresh on every connect* — so a rotated DB secret is picked up
 *   on the next reload. This is the bootstrap-friendly default: AppConfig runs before the app is
 *   wired and the DB credentials live in env/secrets.
 *
 * - **Injected pool** (`{ pool }`): the source borrows an externally-owned `pg` {@link Pool}.
 *   `load`/`get` run through `pool.query` (auto checkout/release); `watch` checks out a dedicated
 *   client and **destroys** it on dispose. The source **never** ends the pool — its lifecycle
 *   belongs to whoever created it. Resolvers do not apply (the pool already owns its credentials),
 *   so they are not part of this variant. Use this when the app already has a pool and the
 *   Postgres connection details are not themselves part of the config being loaded.
 */
export type AppConfigSourcePostgresSource =
  | { connection: AppConfigSourcePostgresConnection; resolvers?: AppConfigResolver[] }
  | { pool: Pool };

/**
 * Options for {@link AppConfigSourcePostgres}.
 *
 * @property schema - Schema holding the settings table. Defaults to `public`.
 * @property table - Table holding the key/value rows. Defaults to `settings`.
 * @property keyColumn - Column read as the config key. Defaults to `key`.
 * @property valueColumn - Column read as the config value. Defaults to `value`.
 * @property notifyChannel - When set, {@link AppConfigSourcePostgres.watch} opens a
 *   dedicated `LISTEN`er on this Postgres channel and fires its callback on every
 *   `NOTIFY` — so a store hot-reloads when the settings change. Without it, `watch` is a
 *   no-op (reload stays driven by the application). Have your settings table emit
 *   `NOTIFY <channel>` (e.g. from a trigger) on insert/update/delete.
 */
export interface AppConfigSourcePostgresOptions {
  schema?: string;
  table?: string;
  keyColumn?: string;
  valueColumn?: string;
  notifyChannel?: string;
}

/** Options with every optional field resolved to its default. */
type ResolvedOptions = Required<Omit<AppConfigSourcePostgresOptions, 'notifyChannel'>> & Pick<AppConfigSourcePostgresOptions, 'notifyChannel'>;

const UNDEFINED_TABLE = '42P01';
const INVALID_SCHEMA = '3F000';

/**
 * Configuration source that loads key/value rows from a Postgres table.
 *
 * Reads a single key/value table (`schema.table`, with configurable column names) and returns
 * it as a flat configuration record. The Postgres connection is supplied via
 * {@link AppConfigSourcePostgresSource} — either an owned connection (parameters the source
 * connects with, optionally resolving `${…}` references) or an injected {@link Pool} the source
 * borrows.
 *
 * The source is deliberately forgiving at boot: if the schema/table does not exist yet (e.g.
 * before the first migration), it logs a warning and returns an empty object rather than
 * throwing, so the rest of the config (env defaults, files) still applies.
 *
 * @example Owned connection (resolved secrets, re-resolved each reload):
 * ```typescript
 * const source = new AppConfigSourcePostgres(
 *   logger,
 *   { connection: { host: 'db', port: 5432, user: 'app', password: '${aws:db/password}', database: 'app' }, resolvers: [awsResolver] },
 *   { schema: 'config', table: 'app_settings' }, // options are optional
 * );
 * const config = await new AppConfigBuilder().addSource(source).buildSnapshot();
 * ```
 *
 * @example Injected pool (the app already owns one; the source never ends it):
 * ```typescript
 * const source = new AppConfigSourcePostgres(logger, { pool }, { schema: 'config' });
 * ```
 */
export class AppConfigSourcePostgres implements AppConfigSource {
  private cache?: Record<string, string>;

  /** Options with all optional fields resolved to their defaults. */
  private readonly options: ResolvedOptions;

  /** Where the connection comes from — owned parameters or an injected pool. */
  private readonly source: AppConfigSourcePostgresSource;

  /**
   * Creates a new AppConfigSourcePostgres instance.
   *
   * @param logger - Logger used to warn when the schema/table is missing.
   * @param source - How to connect: owned `{ connection, resolvers? }` or an injected `{ pool }`
   *   (see {@link AppConfigSourcePostgresSource}).
   * @param options - Optional schema/table/column names and `notifyChannel`.
   */
  constructor(
    private readonly logger: Logger,
    source: AppConfigSourcePostgresSource,
    options: AppConfigSourcePostgresOptions = {},
  ) {
    this.source = source;
    this.options = {
      schema: options.schema ?? 'public',
      table: options.table ?? 'settings',
      keyColumn: options.keyColumn ?? 'key',
      valueColumn: options.valueColumn ?? 'value',
      notifyChannel: options.notifyChannel,
    };
  }

  /**
   * Loads configuration from the Postgres settings table.
   *
   * In owned-connection mode any `${…}` references in the connection parameters are resolved
   * through the configured resolvers first (re-resolved on every call, so a rotated DB secret is
   * picked up on reload), then the source connects and reads the table. In pool mode the query
   * runs through the injected pool. Returns an empty object (without throwing) when the configured
   * schema/table does not exist yet. Rows whose key or value is null are skipped.
   *
   * @returns A promise resolving to a flat record of the table's key/value rows.
   * @throws Re-throws any Postgres/connection error other than
   *   "undefined table" (`42P01`) and "invalid schema" (`3F000`).
   */
  async load(): Promise<Record<string, unknown>> {
    try {
      // Identifiers are static / configured (never user input), so plain interpolation is safe —
      // there are no parameters to bind here.
      const { rows } = await this.query<{ key: string; value: string | null }>(
        `SELECT "${this.options.keyColumn}" AS key, "${this.options.valueColumn}" AS value FROM "${this.options.schema}"."${this.options.table}"`,
      );

      const out: Record<string, string> = {};
      for (const { key, value } of rows) {
        if (key && value !== null) out[key] = value;
      }
      // Cache for get(): a `${pg:…}` reference reads this snapshot instead of re-querying,
      // and a reload refreshes it.
      this.cache = out;
      return out;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === UNDEFINED_TABLE || code === INVALID_SCHEMA) {
        this.logger.warn(`AppConfigSourcePostgres: ${this.options.schema}.${this.options.table} does not exist yet — using env defaults`);
        this.cache = {};
        return {};
      }
      throw err;
    }
  }

  /**
   * Fetches and parses a single setting by key from the most recent {@link AppConfigSourcePostgres.load}
   * snapshot — the {@link AppConfigSource.get} capability behind
   * {@link import('../resolvers/app.config.resolver.postgres.js').AppConfigResolverPostgres}
   * resolving `${pg:KEY}` references.
   *
   * It reads the **cached bulk load**, never querying per key — so add the source to the
   * builder too (`addSource(pg)`): its `load()` runs before resolvers and populates the
   * snapshot, and each reload refreshes it. Calling `get` before the source has been loaded
   * throws (add it as a source).
   *
   * Unlike {@link AppConfigSourcePostgres.load}, which is forgiving (a missing table yields
   * an empty layer), `get` is **strict**: a `${pg:…}` reference to a key absent from the
   * snapshot throws, so a misconfigured reference fails loud rather than silently dropping a value.
   *
   * @param key - The key to look up in the loaded settings.
   * @returns The JSON-parsed value (the raw string when not JSON).
   * @throws {ServerkitError} When the source has not been loaded, or the key is absent from the snapshot.
   */
  async get(key: string): Promise<unknown> {
    if (this.cache === undefined) {
      throw new ServerkitError(
        'AppConfigSourcePostgres: get() requires the source to be loaded — add it to the builder via addSource',
      ).withInternalDetails({ key });
    }

    const value = this.cache[key];
    if (value === undefined) {
      throw new ServerkitError(
        `AppConfigSourcePostgres: no value for key "${key}" in ${this.options.schema}.${this.options.table}`,
      ).withInternalDetails({ key });
    }
    return tryParseJson(value);
  }

  /**
   * Watches the settings table for changes via Postgres `LISTEN`/`NOTIFY`, firing `onChange`
   * on every `NOTIFY` to the configured {@link AppConfigSourcePostgresOptions.notifyChannel}.
   *
   * Holds a dedicated long-lived connection (separate from the short-lived `load`/`get` queries)
   * and `LISTEN`s on the channel — its own {@link Client} in owned mode, or a client checked out
   * of the injected pool. The connect + `LISTEN` happen asynchronously; the disposer returned here
   * is synchronous and tears the listener down (and cancels a connect still in flight). Best-effort:
   * a dropped listen connection is logged, not auto-reconnected, so the application's `reload()`
   * trigger remains the backstop. A no-op when no `notifyChannel` is configured.
   *
   * Have the settings table `NOTIFY <channel>` on change (typically a trigger on
   * insert/update/delete); the payload is ignored — any notification triggers a reload.
   *
   * @param onChange - Invoked on each `NOTIFY` to the channel.
   * @returns A disposer that stops listening and releases the connection.
   */
  watch(onChange: () => void): () => void {
    const channel = this.options.notifyChannel;
    if (!channel) {
      return () => {};
    }

    let close: (() => void) | undefined;
    let disposed = false;

    void this.acquireListener(channel, onChange)
      .then(dispose => {
        if (disposed) {
          // Disposed before the connect resolved — tear the just-acquired listener down.
          dispose();
        } else {
          close = dispose;
        }
      })
      .catch((err: unknown) => this.logger.error(`AppConfigSourcePostgres: failed to LISTEN on "${channel}"`, err));

    return () => {
      disposed = true;
      close?.();
      close = undefined;
    };
  }

  /**
   * Runs a read query against the configured source.
   *
   * In pool mode the query goes through `pool.query` (auto checkout/release; the pool is never
   * ended here). In owned mode a fresh client is opened with freshly-resolved connection
   * parameters and always closed afterwards.
   *
   * @param sql - The query text. Identifiers are pre-interpolated; there are no bind parameters.
   * @returns The query result rows.
   * @internal
   */
  private async query<T extends Record<string, unknown>>(sql: string): Promise<{ rows: T[] }> {
    if ('pool' in this.source) {
      return this.source.pool.query<T>(sql);
    }

    const client = await this.newClient();
    try {
      await client.connect();
      return await client.query<T>(sql);
    } finally {
      await client.end().catch(() => {});
    }
  }

  /**
   * Opens a dedicated connection, attaches the notification handler, starts listening, and returns
   * a disposer that releases that connection.
   *
   * The listen connection is never returned to the pool intact: a `LISTEN` is bound to a physical
   * backend, so handing it back would leave the subscription live on a connection the pool reuses.
   * In pool mode the disposer therefore destroys the checked-out client (`release(true)`); in owned
   * mode it ends the client.
   *
   * @param channel - The Postgres channel to `LISTEN` on.
   * @param onChange - Invoked on each notification.
   * @returns A disposer that stops listening and releases the connection.
   * @internal
   */
  private async acquireListener(channel: string, onChange: () => void): Promise<() => void> {
    const isPool = 'pool' in this.source;
    const client = isPool ? await this.source.pool.connect() : await this.connectedClient();

    // pg's Client/PoolClient is an EventEmitter; an unhandled 'error' event would throw. Log instead
    // so a dropped listen connection degrades to "no live notifications" rather than crashing.
    client.on('error', (err: Error) => this.logger.error(`AppConfigSourcePostgres: LISTEN connection error on "${channel}"`, err));
    client.on('notification', () => onChange());
    // Channel is configured (never user input); quote it to preserve case. LISTEN takes no
    // bind parameters.
    await client.query(`LISTEN "${channel}"`);

    return () => {
      client.removeAllListeners('notification');
      if ('release' in client) {
        // Destroy (true) rather than return to the pool — see method note.
        client.release(true);
      } else {
        void client.end().catch(() => {});
      }
    };
  }

  /**
   * Builds and connects an owned `pg` {@link Client}. Owned mode only.
   *
   * @returns A connected client.
   * @internal
   */
  private async connectedClient(): Promise<Client> {
    const client = await this.newClient();
    await client.connect();
    return client;
  }

  /**
   * Builds a `pg` client from a freshly-resolved copy of the owned connection. Owned mode only.
   *
   * Resolved per call so the original `${…}` templates survive for the next call (a rotated
   * secret is picked up on the next reload) and are never mutated in place.
   *
   * @returns A new, not-yet-connected client.
   * @internal
   */
  private async newClient(): Promise<Client> {
    if (!('connection' in this.source)) {
      // Invariant: only owned mode reaches here — pool mode never opens its own client.
      throw new ServerkitError('AppConfigSourcePostgres: newClient is unavailable in pool mode');
    }

    const connection: AppConfigSourcePostgresConnection = { ...this.source.connection };
    await resolveValues(connection, this.source.resolvers ?? []);
    return new Client({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      database: connection.database,
      // Short, self-contained connection: fail fast rather than hang boot
      // (or a reload) when the database is unreachable.
      connectionTimeoutMillis: 5000,
    });
  }
}
