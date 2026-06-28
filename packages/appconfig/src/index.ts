export { AppConfig } from './app.config.js';
export { AppConfigBuilder } from './app.config.builder.js';
export { buildConfigObject } from './pipeline.js';

export type { AppConfigResolver } from './app.config.resolver.js';
export type { AppConfigSource } from './app.config.source.js';

// Backends that need an optional peer dependency live behind their own entry
// points so importing the core never statically loads pg / yaml / the cloud
// secret-manager SDKs:
//   @maroonedsoftware/appconfig/postgres  → pg
//   @maroonedsoftware/appconfig/yaml      → yaml
//   @maroonedsoftware/appconfig/aws        → @aws-sdk/client-secrets-manager
//   @maroonedsoftware/appconfig/gcp        → @google-cloud/secret-manager

// Sources
export { AppConfigSourceFile } from './sources/app.config.source.file.js';
export type { AppConfigSourceFileOptions } from './sources/app.config.source.file.js';
export { AppConfigSourceJson } from './sources/app.config.source.json.js';
export { AppConfigSourceDotenv } from './sources/app.config.source.dotenv.js';
export type { AppConfigSourceDotenvOptions } from './sources/app.config.source.dotenv.js';
export { AppConfigSourceFetch } from './sources/app.config.source.fetch.js';
export type { AppConfigSourceFetchOptions } from './sources/app.config.source.fetch.js';

// Resolvers
export { AppConfigKeyedResolver } from './resolvers/app.config.resolver.keyed.js';
export { AppConfigResolverEnv } from './resolvers/app.config.resolver.env.js';

// Pipeline passes
export { resolveValues } from './resolve.js';
export { resolveReferences } from './references.js';
export type { ResolveReferencesOptions } from './references.js';
export { nestKeys } from './helpers.js';

// Live configuration
export { AppConfigSection } from './options/app.config.section.js';
export { AppConfigModule } from './options/app.config.module.js';
export { AppConfigStore } from './options/app.config.store.js';
export type { AppConfigStoreListener, AppConfigStoreParams } from './options/app.config.store.js';
export { registerLiveAppConfig } from './options/app.config.options.registration.js';
