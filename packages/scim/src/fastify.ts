// Fastify transport for @maroonedsoftware/scim. Reachable only through the
// `@maroonedsoftware/scim/fastify` subpath, so the root entry stays free of Fastify.
export * from './fastify/scim.fastify.routes.js';
export * from './fastify/require.scim.scope.hook.js';
