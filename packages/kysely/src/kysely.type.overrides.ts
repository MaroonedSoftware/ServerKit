import { DateTime } from 'luxon';
import * as pg from 'pg';

const parseTimestamp = (value: string) => {
  return DateTime.fromSQL(value, { zone: 'utc' });
};

const parseBigInt = (value: string) => BigInt(value);

/**
 * PostgreSQL type overrides for use with a `KyselyPool`.
 *
 * Replaces the default `pg` parsers for three common types:
 *
 * | PostgreSQL type | Default JS type | Override        |
 * | --------------- | --------------- | --------------- |
 * | `TIMESTAMP`     | `string`        | `DateTime` (UTC)|
 * | `TIMESTAMPTZ`   | `string`        | `DateTime` (UTC)|
 * | `INT8` / bigint | `string`        | `BigInt`        |
 *
 * Timestamps are parsed as [Luxon](https://moment.github.io/luxon/) `DateTime`
 * objects in the UTC zone. Large integers are parsed as native `BigInt` values
 * to avoid precision loss beyond `Number.MAX_SAFE_INTEGER`.
 *
 * Pass this to the `types` option of `KyselyPool` (or `pg.Pool`):
 *
 * @example
 * ```typescript
 * import { KyselyPool, KyselyPgTypeOverrides } from '@maroonedsoftware/kysely';
 *
 * const pool = new KyselyPool({
 *   connectionString: process.env.DATABASE_URL,
 *   types: KyselyPgTypeOverrides,
 * });
 * ```
 */
export const KyselyPgTypeOverrides = new pg.TypeOverrides();
KyselyPgTypeOverrides.setTypeParser(pg.types.builtins.TIMESTAMPTZ, parseTimestamp);
KyselyPgTypeOverrides.setTypeParser(pg.types.builtins.TIMESTAMP, parseTimestamp);
KyselyPgTypeOverrides.setTypeParser(pg.types.builtins.INT8, parseBigInt);
