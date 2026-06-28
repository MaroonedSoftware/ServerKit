// Postgres entry point (`@maroonedsoftware/appconfig/postgres`). Importing this
// module pulls in the `pg` peer dependency; the core entry does not.
export { AppConfigSourcePostgres } from './sources/app.config.source.postgres.js';
export type {
  AppConfigSourcePostgresOptions,
  AppConfigSourcePostgresConnection,
  AppConfigSourcePostgresSource,
} from './sources/app.config.source.postgres.js';
export { AppConfigResolverPostgres } from './resolvers/app.config.resolver.postgres.js';
