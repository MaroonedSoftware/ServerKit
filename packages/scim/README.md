# @maroonedsoftware/scim

SCIM 2.0 (RFC 7643/7644) server toolkit for ServerKit.

This package provides the protocol layer — schemas, filter parser, PATCH applier, error envelope — for building a SCIM server, plus HTTP transports for Koa and Fastify at subpaths. Resource storage is left to the consumer via abstract repositories, matching the pattern used by `@maroonedsoftware/authentication` and `@maroonedsoftware/permissions`.

## What's included

- **Resource schemas** — `User`, `Group`, and the `EnterpriseUser` extension (RFC 7643).
- **Filter parser** — full SCIM filter grammar (RFC 7644 §3.4.2.2) returning a typed AST.
- **PATCH applier** — `add` / `replace` / `remove` ops with the path mini-language (RFC 7644 §3.5.2).
- **Attribute projection** — `projectScimResource(resource, schemas, projection)` applies `attributes` / `excludedAttributes` (RFC 7644 §3.9) and always strips `returned: 'never'` attributes such as `password`. The router applies it to every user and group response.
- **Error envelope** — `scimError(status, scimType?, statusText?)` builder producing the SCIM error JSON; the operator-facing reason goes on `.withDetails({ message })` and is rendered as the envelope's `detail`.
- **Abstract repositories** — `ScimUserRepository`, `ScimGroupRepository`. The consumer implements these against their datastore.
- **Services** — `ScimUserService`, `ScimGroupService`, `ScimServiceProviderService`.
- **Scope helpers** — `hasScimScope(session, scope)` and `assertScimScope(session, scope)`, the transport-neutral check behind every `requireScimScope` guard.
- **`SCIM_MEDIA_TYPE`** — `'application/scim+json'`.
- **Fastify transport** (`@maroonedsoftware/scim/fastify`) — `scimRoutes(options)`, an encapsulated Fastify plugin mounting the same endpoints with the same semantics, plus a `requireScimScope(scope)` `preHandler`.
- **Koa transport** (`@maroonedsoftware/scim/koa`) — `createScimRouter(options)` mounting the standard SCIM endpoints, plus `scimErrorMiddleware()`, `scimContentTypeMiddleware()`, and `requireScimScope(scope)`.

## Entry points

| Import                           | Contents                                                                                    | Needs                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `@maroonedsoftware/scim`         | Types, schemas, filter, PATCH, projection, errors, repositories, services, scope helpers.   | Nothing framework-specific.                                                    |
| `@maroonedsoftware/scim/koa`     | `createScimRouter`, `scimErrorMiddleware`, `scimContentTypeMiddleware`, `requireScimScope`. | `@maroonedsoftware/koa`, `koa`, `@koa/router`.                                 |
| `@maroonedsoftware/scim/fastify` | `scimRoutes`, `ScimRoutesOptions`, `requireScimScope`.                                      | `fastify` (v5); `@maroonedsoftware/fastify` for the ServerKit request context. |

The framework packages are optional peer dependencies: install the ones for the transport you use.

```bash
pnpm add @maroonedsoftware/scim @maroonedsoftware/koa koa @koa/router   # Koa
pnpm add @maroonedsoftware/scim @maroonedsoftware/fastify fastify       # Fastify
```

## Quick start (Koa)

```ts
import Koa from 'koa';
import { ServerKitContext, serverKitContextMiddleware, authenticationMiddleware } from '@maroonedsoftware/koa';
import { ScimGroupRepository, ScimGroupService, ScimServiceProviderService, ScimUserRepository, ScimUserService } from '@maroonedsoftware/scim';
import { createScimRouter, requireScimScope, scimErrorMiddleware } from '@maroonedsoftware/scim/koa';

class MyScimUserRepository extends ScimUserRepository {
  // implement against your datastore
}

class MyScimGroupRepository extends ScimGroupRepository {
  // implement against your datastore
}

const app = new Koa();
app.use(serverKitContextMiddleware(container));
app.use(authenticationMiddleware());

// The router takes services, not repositories: the service owns id and meta
// assignment, uniqueness, and PATCH application.
const serviceProviderService = new ScimServiceProviderService({
  documentationUri: 'https://example.com/scim/docs',
  patch: { supported: true },
  filter: { supported: true, maxResults: 200 },
  sort: { supported: true },
});

const scimRouter = createScimRouter({
  userService: new ScimUserService(new MyScimUserRepository(), logger),
  groupService: new ScimGroupService(new MyScimGroupRepository(), logger),
  serviceProviderService,
  routeGuards: [requireScimScope('scim')],
  // Where this router is reachable. Set it whenever you mount under a prefix,
  // or `meta.location` and the `Location` header will be wrong.
  baseUrl: 'https://api.example.com/scim/v2',
});

app.use(scimErrorMiddleware());
app.use(scimRouter.routes());
app.use(scimRouter.allowedMethods());
```

## Fastify

`scimRoutes` takes the same options as `createScimRouter`, with `routeGuards` as Fastify `preHandler` hooks. Register it after the ServerKit plugin stack, under a prefix:

```ts
import { ServerKitServerBuilder } from '@maroonedsoftware/fastify';
import { ScimGroupService, ScimServiceProviderService, ScimUserService } from '@maroonedsoftware/scim';
import { requireScimScope, scimRoutes } from '@maroonedsoftware/scim/fastify';

const builder = new ServerKitServerBuilder();
await builder.setup(config, logger, modules);

builder.setupPlugins().setupRoutes([
  {
    prefix: '/scim/v2',
    plugin: scimRoutes({
      userService: new ScimUserService(new MyScimUserRepository(), logger),
      groupService: new ScimGroupService(new MyScimGroupRepository(), logger),
      serviceProviderService,
      routeGuards: [requireScimScope('scim')],
      baseUrl: 'https://api.example.com/scim/v2',
    }),
  },
]);
```

The plugin is encapsulated, so what it installs applies only to the SCIM routes:

- a scoped error handler rendering every failure as the SCIM error envelope with `Content-Type: application/scim+json` (no separate error middleware to mount);
- a scoped not-found handler, when mounted under a prefix, answering unknown SCIM paths with a SCIM 404;
- body parsing for `application/scim+json` and `application/json`. Under ServerKit, routes declare both in `config.body` and ServerKit's own parsers read them; on a plain Fastify instance the plugin registers a JSON parser for `application/scim+json` in its scope.

## Authentication

This package does not validate bearer tokens itself. The transport reads the request's authentication session (`ctx.authenticationSession` from `authenticationMiddleware()` in `@maroonedsoftware/koa`, or `request.authenticationSession` from `authenticationPlugin()` in `@maroonedsoftware/fastify`) and its `requireScimScope(scope)` guard checks for SCIM scopes on `session.claims.scimScopes` via `assertScimScope`. You register an `AuthenticationSchemeHandler` in your app that turns IdP-issued bearer tokens into a session.

## Compliance testing

The router has been designed against RFC 7643/7644. To validate against a real IdP, point Okta or [`scim2-compliance-test-utils`](https://github.com/suvera/scim2-compliance-test-utils) at a sample app that mounts `createScimRouter` or `scimRoutes`.

## Migrating from 0.x

The router and Koa middleware moved off the root entry so it no longer loads Koa:

```diff
-import { createScimRouter, requireScimScope, scimErrorMiddleware, scimContentTypeMiddleware } from '@maroonedsoftware/scim';
+import { createScimRouter, requireScimScope, scimErrorMiddleware, scimContentTypeMiddleware } from '@maroonedsoftware/scim/koa';
```

`SCIM_MEDIA_TYPE` stays on the root entry. `@maroonedsoftware/koa`, `koa`, and `@koa/router` are now optional peers, so add them to your app's dependencies if they were only arriving through this package.

## License

MIT — see [LICENSE](./LICENSE).
