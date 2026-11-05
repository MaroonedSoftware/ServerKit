import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv, AppConfigSourceEnv, AppConfigSourceJson } from '@maroonedsoftware/appconfig';
// Backends that need an optional peer live behind subpaths, so the root entry never loads them.
import { AppConfigResolverGcpSecrets } from '@maroonedsoftware/appconfig/gcp';
import { AppConfigSourceYaml } from '@maroonedsoftware/appconfig/yaml';

export type ApplicationConfig = {
  server: {
    port: number;
    host: string;
    publicUrl: string;
  };
  database: {
    url: string;
    poolSize: number;
  };
  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
  };
  email: {
    apiKey: string;
    from: string;
  };
};

/**
 * Loads the configuration from every layer. Later sources win the deep merge:
 *
 * 1. config.json: base values
 * 2. config.yaml: environment-specific overrides
 * 3. .env: local values, also copied into process.env (overwriting what is there by default)
 * 4. process.env: nested on `__`, so SERVER__port=8080 becomes server.port. Keys are not case folded.
 *
 * Resolvers then replace placeholders in the merged result, and resolveReferences() runs last:
 *
 * - ${env:KEY}: an environment variable, interpolated within the string
 * - ${gcp:SECRET_ID}: a secret from GCP Secret Manager, in the project given to the resolver
 * - ${ref:some.path}: another value in this config
 */
export const loadConfig = (gcpProjectId: string) =>
  new AppConfigBuilder()
    .addSource(new AppConfigSourceJson('./config.json'))
    .addSource(new AppConfigSourceYaml('./config.yaml'))
    .addSource(new AppConfigSourceDotenv('.env'))
    .addSource(new AppConfigSourceEnv({ groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .addResolver(new AppConfigResolverGcpSecrets(gcpProjectId))
    .resolveReferences()
    .buildSnapshot<ApplicationConfig>();

// Example config.json:
// {
//   "server": { "port": 3000, "host": "0.0.0.0", "publicUrl": "https://${ref:server.host}" },
//   "database": { "url": "${env:DATABASE_URL}", "poolSize": 10 }
// }

// Example config.yaml:
// auth:
//   jwtSecret: ${gcp:jwt-secret}
//   jwtExpiresIn: 7d
// email:
//   apiKey: ${gcp:sendgrid-api-key}
//   from: noreply@example.com

// Example .env:
// DATABASE_URL=postgresql://user:pass@localhost:5432/mydb

// A service takes its typed section, not AppConfig. Wire that in a module's setup hook:
// registry.register(MailerConfig).useInstance(config.getAs<MailerConfig>('email'));
