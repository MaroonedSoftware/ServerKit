// AWS Secrets Manager entry point (`@maroonedsoftware/appconfig/aws`). Importing
// this module pulls in the `@aws-sdk/client-secrets-manager` peer dependency;
// the core entry does not.
export { AppConfigSourceAwsSecrets } from './sources/app.config.source.aws.secrets.js';
export type { AppConfigSourceAwsSecretsOptions } from './sources/app.config.source.aws.secrets.js';
export { AppConfigResolverAwsSecrets } from './resolvers/app.config.resolver.aws.secrets.js';
