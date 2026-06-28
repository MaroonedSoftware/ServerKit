// Core entry — the backend-agnostic abstraction, errors, and the dependency-free
// disk backend. The cloud backends live in their own entry points
// (`@maroonedsoftware/storage/s3`, `@maroonedsoftware/storage/gcs`) so importing
// the core never statically loads the optional AWS / GCS SDKs.
export * from './storage.provider.js';
export * from './storage.errors.js';
export * from './disk.storage.provider.js';
