// Core entry — the backend-agnostic abstraction. The ioredis backend lives in
// its own entry point (`@maroonedsoftware/cache/ioredis`) so importing the core
// never statically loads the optional `ioredis` peer dependency.
export * from './cache.provider.js';
export * from './idempotency.store.js';
