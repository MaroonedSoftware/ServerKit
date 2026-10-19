---
'@maroonedsoftware/scim': minor
---

`scimRoutes` and `createScimRouter` take `resolveServices` in place of the three service instances, called with each request after the route guards, so repositories can be request-scoped (a per-request transaction or tenant). `fromRequestContainer`, from `/fastify` and `/koa`, resolves `ScimUserService`, `ScimGroupService` and `ScimServiceProviderService` from the request's scoped container. `ScimRoutesOptions` and `CreateScimRouterOptions` are now type aliases, and the root entry exports `ScimServices` and the option types.

`requireScimScope` and `hasScimScope` read the session's delegated scopes (an `ApiKeyService` key's, or an OAuth grant's) when it carries no `claims.scimScopes`, so a key issued to an identity provider works without minting a custom claim. A session that sets `scimScopes` is read as before.
