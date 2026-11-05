import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv, AppConfigSourceJson } from '@maroonedsoftware/appconfig';

// Top-level sections, read with config.get('server') or config.getAs<T>('server').
export type ApplicationConfig = {
  server: {
    port: number;
    host: string;
    corsOrigins: string[];
  };
  database: {
    url: string;
    poolSize: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
};

/**
 * Loads the configuration once, at boot.
 *
 * Sources are deep merged in order, so a later source wins. Arrays are replaced, not concatenated.
 * Resolvers then replace placeholders in the merged result. Sources all load before any resolver runs,
 * and the dotenv source copies .env into process.env, so ${env:KEY} can read a key defined in .env.
 * A missing config.json or .env yields an empty layer rather than an error, unless the source is
 * constructed with { ignoreMissingFile: false }.
 */
export const loadConfig = () =>
  new AppConfigBuilder()
    .addSource(new AppConfigSourceJson('./config.json'))
    .addSource(new AppConfigSourceDotenv('.env'))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot<ApplicationConfig>();

// Example config.json:
// {
//   "server": { "port": "${env:PORT}", "host": "0.0.0.0", "corsOrigins": ["http://localhost:3001"] },
//   "database": { "url": "${env:DATABASE_URL}", "poolSize": 10 },
//   "logging": { "level": "info" }
// }

// Example .env:
// DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
// PORT=3000

// Usage:
// const config = await loadConfig();
// const { port } = config.get('server');
// await builder.setup(config, logger, modules);
