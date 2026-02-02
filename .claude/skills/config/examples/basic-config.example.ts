import {
  AppConfigBuilder,
  AppConfigSourceJson,
  AppConfigSourceDotenv,
  AppConfigProviderDotenv
} from '@maroonedsoftware/appconfig';

// Define your config type
interface AppConfig {
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
    prettyPrint: boolean;
  };
}

/**
 * Load application configuration
 *
 * Merges config.json and .env files, with .env taking precedence.
 * Resolves ${env:VAR_NAME} placeholders with environment variables.
 */
export const loadConfig = async (): Promise<AppConfig> => {
  return await new AppConfigBuilder()
    .addSource(new AppConfigSourceJson('./config.json'))
    .addSource(new AppConfigSourceDotenv('.env'))
    .addProvider(new AppConfigProviderDotenv())
    .build<AppConfig>();
};

// Example config.json:
// {
//   "server": {
//     "port": 3000,
//     "host": "0.0.0.0",
//     "corsOrigins": ["http://localhost:3001"]
//   },
//   "database": {
//     "url": "${env:DATABASE_URL}",
//     "poolSize": 10
//   },
//   "logging": {
//     "level": "info",
//     "prettyPrint": false
//   }
// }

// Example .env:
// DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
// PORT=3000

// Usage:
// import { loadConfig } from './config/app.config';
//
// const config = await loadConfig();
// console.log('Server port:', config.server.port);
// console.log('Database URL:', config.database.url);
