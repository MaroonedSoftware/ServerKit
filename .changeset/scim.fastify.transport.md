---
'@maroonedsoftware/scim': minor
---

Add a Fastify transport at `@maroonedsoftware/scim/fastify`: `scimRoutes(options)` is an encapsulated Fastify plugin serving the same SCIM endpoints with the same semantics as `createScimRouter` (projection, `Location` and `meta.location` against `baseUrl`, 201/204 codes, the SCIM error envelope), and `requireScimScope(scope)` is its `preHandler` guard. `fastify` and `@maroonedsoftware/fastify` are optional peers.
