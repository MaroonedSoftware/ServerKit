# @maroonedsoftware/scim

SCIM 2.0 (RFC 7643/7644) server toolkit for ServerKit.

This package provides the protocol layer — schemas, filter parser, PATCH applier, error envelope, and a Koa router — for building a SCIM server. Resource storage is left to the consumer via abstract repositories, matching the pattern used by `@maroonedsoftware/authentication` and `@maroonedsoftware/permissions`.

## What's included

- **Resource schemas** — `User`, `Group`, and the `EnterpriseUser` extension (RFC 7643).
- **Filter parser** — full SCIM filter grammar (RFC 7644 §3.4.2.2) returning a typed AST.
- **PATCH applier** — `add` / `replace` / `remove` ops with the path mini-language (RFC 7644 §3.5.2).
- **Error envelope** — `scimError(status, scimType?)` builder producing the SCIM error JSON.
- **Abstract repositories** — `ScimUserRepository`, `ScimGroupRepository`. The consumer implements these against their datastore.
- **Services** — `ScimUserService`, `ScimGroupService`, `ScimServiceProviderService`.
- **Koa middleware** — `scimErrorMiddleware()`, `scimContentTypeMiddleware()`, `requireScimScope(scope)`.
- **Router factory** — `createScimRouter(options)` mounting the standard SCIM endpoints.

## Quick start

```ts
import Koa from 'koa';
import { ServerKitContext, serverKitContextMiddleware, authenticationMiddleware } from '@maroonedsoftware/koa';
import { createScimRouter, ScimUserRepository, ScimGroupRepository, scimErrorMiddleware } from '@maroonedsoftware/scim';

class MyScimUserRepository extends ScimUserRepository {
  // implement against your datastore
}

class MyScimGroupRepository extends ScimGroupRepository {
  // implement against your datastore
}

const app = new Koa();
app.use(serverKitContextMiddleware(container));
app.use(authenticationMiddleware());

const scimRouter = createScimRouter({
  userRepository: new MyScimUserRepository(),
  groupRepository: new MyScimGroupRepository(),
  basePath: '/scim/v2',
  serviceProviderConfig: {
    documentationUri: 'https://example.com/scim/docs',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: true },
    etag: { supported: false },
  },
});

app.use(scimErrorMiddleware());
app.use(scimRouter.routes());
```

## Authentication

This package does not validate bearer tokens itself. It reads `ctx.authenticationSession` (populated by `authenticationMiddleware()` from `@maroonedsoftware/koa`) and provides a `requireScimScope(scope)` guard that checks for SCIM scopes on `session.claims.scimScopes`. You register an `AuthenticationSchemeHandler` in your app that turns IdP-issued bearer tokens into a session.

## Compliance testing

The router has been designed against RFC 7643/7644. To validate against a real IdP, point Okta or [`scim2-compliance-test-utils`](https://github.com/suvera/scim2-compliance-test-utils) at a sample app that mounts `createScimRouter`.
