import { Client } from 'pg';
import type { AppConfigSource } from '../app.config.source.js';
import { Logger } from '@maroonedsoftware/logger';
import { Injectable } from 'injectkit';

/**
 * Postgres connection parameters used by {@link AppConfigPostgresSource}.
 *
 * Mirrors the subset of `pg`'s `ClientConfig` the source needs, supplied via
 * {@link AppConfigPostgresSourceOptions.connection}.
 */
export interface AppConfigPostgresConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Options for {@link AppConfigPostgresSource}.
 *
 * Declared as an `@Injectable()` class so it can mint a DI token and be resolved
 * from the container, like the other configuration options classes in the repo.
 *
 * @property connection - Postgres connection parameters. Required.
 * @property schema - Schema holding the settings table. Defaults to `public`.
 * @property table - Table holding the key/value rows. Defaults to `settings`.
 * @property keyColumn - Column read as the config key. Defaults to `key`.
 * @property valueColumn - Column read as the config value. Defaults to `value`.
 */
@Injectable()
export class AppConfigPostgresSourceOptions {
  constructor(
    public connection: AppConfigPostgresConnection,
    public schema?: string,
    public table?: string,
    public keyColumn?: string,
    public valueColumn?: string,
  ) {}
}

const UNDEFINED_TABLE = '42P01';
const INVALID_SCHEMA = '3F000';

/**
 * Configuration source that loads key/value rows from a Postgres table.
 *
 * Reads a single key/value table (`schema.table`, with configurable column
 * names) and returns it as a flat configuration record. Connection parameters
 * and the schema are supplied via {@link AppConfigPostgresSourceOptions}.
 *
 * The source is deliberately forgiving at boot: if the schema/table does not
 * exist yet (e.g. before the first migration), it logs a warning and returns an
 * empty object rather than throwing, so the rest of the config (env defaults,
 * files) still applies.
 *
 * @example
 * ```typescript
 * const source = new AppConfigPostgresSource(logger, {
 *   connection: { host: 'db', port: 5432, user: 'app', password: 'secret', database: 'app' },
 *   schema: 'config',      // optional, defaults to 'public'
 *   table: 'app_settings', // optional, defaults to 'settings'
 *   keyColumn: 'name',     // optional, defaults to 'key'
 *   valueColumn: 'val',    // optional, defaults to 'value'
 * });
 *
 * const config = await new AppConfigBuilder().addSource(source).build();
 * ```
 */
export class AppConfigPostgresSource implements AppConfigSource {
  private readonly schema: string;
  private readonly table: string;
  private readonly keyColumn: string;
  private readonly valueColumn: string;
  private readonly connectionOverride: AppConfigPostgresConnection;

  /**
   * Creates a new AppConfigPostgresSource instance.
   *
   * @param logger - Logger used to warn when the schema/table is missing.
   * @param options - Connection parameters and optional schema/table/column names.
   */
  constructor(
    private readonly logger: Logger,
    options: AppConfigPostgresSourceOptions,
  ) {
    this.schema = options.schema ?? 'public';
    this.table = options.table ?? 'settings';
    this.keyColumn = options.keyColumn ?? 'key';
    this.valueColumn = options.valueColumn ?? 'value';
    this.connectionOverride = options.connection;
  }

  /**
   * Loads configuration from the Postgres settings table.
   *
   * Returns an empty object (without throwing) when the configured schema/table
   * does not exist yet. Rows whose key or value is null are skipped.
   *
   * @returns A promise resolving to a flat record of the table's key/value rows.
   * @throws Re-throws any Postgres/connection error other than
   *   "undefined table" (`42P01`) and "invalid schema" (`3F000`).
   */
  async load(): Promise<Record<string, unknown>> {
    const client = new Client({
      host: this.connectionOverride.host,
      port: this.connectionOverride.port,
      user: this.connectionOverride.user,
      password: this.connectionOverride.password,
      database: this.connectionOverride.database,
      // Short, self-contained connection: fail fast rather than hang boot
      // (or a reload) when the database is unreachable.
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      // Identifiers are static / configured (never user input), so plain
      // interpolation is safe — there are no parameters to bind here.
      const { rows } = await client.query<{ key: string; value: string | null }>(
        `SELECT "${this.keyColumn}" AS key, "${this.valueColumn}" AS value FROM "${this.schema}"."${this.table}"`,
      );

      const out: Record<string, string> = {};
      for (const { key, value } of rows) {
        if (key && value !== null) out[key] = value;
      }
      return out;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === UNDEFINED_TABLE || code === INVALID_SCHEMA) {
        this.logger.warn(`AppConfigPostgresSource: ${this.schema}.${this.table} does not exist yet — using env defaults`);
        return {};
      }
      throw err;
    } finally {
      await client.end().catch(() => {});
    }
  }
}
