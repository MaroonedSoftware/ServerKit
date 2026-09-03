/**
 * `@maroonedsoftware/fastify/zod` — Zod validation and serialization for Fastify routes, wiring
 * `@maroonedsoftware/zod` into Fastify's own schema compilers. Imported via the `/zod` subpath so
 * base fastify users don't pull in `@maroonedsoftware/zod`, `zod`, or `fast-json-stringify` (all
 * optional peer dependencies).
 */
export * from './zod/zod.type.provider.js';
export * from './zod/zod.validator.compiler.js';
export * from './zod/zod.serializer.compiler.js';
export * from './zod/zod.plugin.js';
