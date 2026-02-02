import {
  AppConfigBuilder,
  AppConfigSourceJson,
  AppConfigSourceYaml,
  AppConfigSourceDotenv,
  AppConfigProviderDotenv,
  AppConfigProviderGcpSecrets
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
  redis: {
    url: string;
    ttl: number;
  };
  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
  };
  email: {
    apiKey: string;
    from: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    prettyPrint: boolean;
  };
}

/**
 * Load application configuration
 *
 * Merges multiple sources in order:
 * 1. config.json - Base configuration
 * 2. config.yaml - Environment-specific overrides
 * 3. .env - Local overrides and secrets
 *
 * Providers resolve placeholders:
 * - ${env:VAR_NAME} - Environment variables
 * - ${gcp:projects/PROJECT_ID/secrets/SECRET_NAME} - GCP Secret Manager
 */
export const loadConfig = async (): Promise<AppConfig> => {
  return await new AppConfigBuilder()
    .addSource(new AppConfigSourceJson('./config.json'))
    .addSource(new AppConfigSourceYaml('./config.yaml'))
    .addSource(new AppConfigSourceDotenv('.env'))
    .addProvider(new AppConfigProviderDotenv())
    .addProvider(new AppConfigProviderGcpSecrets())
    .build<AppConfig>();
};

// Example config.json (base configuration):
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
//   "redis": {
//     "url": "${env:REDIS_URL}",
//     "ttl": 3600
//   },
//   "logging": {
//     "level": "info",
//     "prettyPrint": false
//   }
// }

// Example config.yaml (environment-specific):
// server:
//   port: ${env:PORT}
//   corsOrigins:
//     - https://example.com
//     - https://app.example.com
// auth:
//   jwtSecret: ${gcp:projects/my-project/secrets/jwt-secret}
//   jwtExpiresIn: "7d"
// email:
//   apiKey: ${gcp:projects/my-project/secrets/sendgrid-api-key}
//   from: noreply@example.com

// Example .env (local development):
// DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
// REDIS_URL=redis://localhost:6379
// PORT=3000

// Usage:
// import { loadConfig } from './config/app.config';
//
// const config = await loadConfig();
// console.log('Server:', config.server.host, config.server.port);
// console.log('Database:', config.database.url);
// console.log('JWT Secret:', config.auth.jwtSecret);
//
// Note: Sources are merged in order (last wins).
// For example, if config.json has port: 3000 and .env has PORT=8080,
// the final config.server.port will be 8080.
