---
'@maroonedsoftware/appconfig': patch
'@maroonedsoftware/authentication': patch
'@maroonedsoftware/cache': patch
'@maroonedsoftware/encryption': patch
'@maroonedsoftware/jobbroker': patch
'@maroonedsoftware/johnny5': patch
'@maroonedsoftware/koa': patch
'@maroonedsoftware/kysely': patch
'@maroonedsoftware/logger': patch
'@maroonedsoftware/permissions': patch
'@maroonedsoftware/permissions-dsl': patch
'@maroonedsoftware/policies': patch
'@maroonedsoftware/scim': patch
'@maroonedsoftware/slack': patch
---

Bump runtime dependencies (notably `injectkit` to 1.4.1) and relax the pgboss job registration type guard so it accepts the updated `Identifier` shape.
