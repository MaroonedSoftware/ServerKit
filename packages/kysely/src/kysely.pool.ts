import { Injectable } from 'injectkit';
import { Pool } from 'pg';

/**
 * An injectable PostgreSQL connection pool for use with Kysely.
 *
 * Extends `pg.Pool` and registers itself with the InjectKit dependency injection
 * container, allowing it to be injected into repositories and services.
 *
 * @example
 * ```typescript
 * import { KyselyPool } from '@maroonedsoftware/kysely';
 * import { Kysely, PostgresDialect } from 'kysely';
 *
 * diRegistry.register(KyselyPool).useInstance(
 *   new KyselyPool({ connectionString: process.env.DATABASE_URL }),
 * );
 *
 * diRegistry.register(Kysely).useFactory(container => {
 *   return new Kysely({
 *     dialect: new PostgresDialect({ pool: container.get(KyselyPool) }),
 *   });
 * });
 * ```
 */
@Injectable()
export class KyselyPool extends Pool {}
