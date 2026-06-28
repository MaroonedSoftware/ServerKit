// GCP Secret Manager entry point (`@maroonedsoftware/appconfig/gcp`). Importing
// this module pulls in the `@google-cloud/secret-manager` peer dependency; the
// core entry does not.
export { AppConfigSourceGcpSecrets } from './sources/app.config.source.gcp.secrets.js';
export type { AppConfigSourceGcpSecretsOptions } from './sources/app.config.source.gcp.secrets.js';
export { AppConfigResolverGcpSecrets } from './resolvers/app.config.resolver.gcp.secrets.js';
