---
'@maroonedsoftware/scim': major
---

Split the SCIM transports: the root entry `@maroonedsoftware/scim` is now transport-free (types, schemas, filter, PATCH, projection, errors, repositories, services), and the Koa router and middleware move to the new `@maroonedsoftware/scim/koa` subpath. Behaviour is unchanged.

The root entry also gains `hasScimScope(session, scope)` and `assertScimScope(session, scope)`, the transport-neutral scope check that `requireScimScope` now delegates to.

**Breaking.** `@maroonedsoftware/koa`, `koa`, and `@koa/router` are now optional peer dependencies instead of a dependency plus required peers, and the router exports are no longer on the root entry. To migrate:

```diff
-import { createScimRouter, requireScimScope, scimErrorMiddleware, scimContentTypeMiddleware } from '@maroonedsoftware/scim';
+import { createScimRouter, requireScimScope, scimErrorMiddleware, scimContentTypeMiddleware } from '@maroonedsoftware/scim/koa';
```

`SCIM_MEDIA_TYPE` stays on the root entry (it is no longer exported from the Koa middleware module). If `@maroonedsoftware/koa` was only arriving through this package, add it, `koa`, and `@koa/router` to your app's dependencies.
