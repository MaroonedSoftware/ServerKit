---
'@maroonedsoftware/scim': minor
---

Add `@maroonedsoftware/scim`, a SCIM 2.0 (RFC 7643/7644) server toolkit. Ships User, Group, and EnterpriseUser schemas, a typed filter parser, a PATCH applier, the SCIM error envelope, abstract `ScimUserRepository` / `ScimGroupRepository` contracts, and a `createScimRouter` factory that mounts the standard `/Users`, `/Groups`, `/Schemas`, `/ResourceTypes`, and `/ServiceProviderConfig` endpoints. Endpoint authentication integrates with `@maroonedsoftware/authentication` via a `requireScimScope(scope)` guard.
