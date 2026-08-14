# AGENTS.md — @maroonedsoftware/scim

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

A SCIM 2.0 (RFC 7643 / 7644) server toolkit: the core schemas (User, Group, EnterpriseUser), the
discovery endpoints, a full filter grammar with a typed AST, a PATCH-op applier with value-path
support, the SCIM error envelope, and a Koa router that mounts all of it over abstract repositories
you implement.

Reach for this when an enterprise customer needs directory-driven user provisioning from Okta, Entra
ID, or similar. Do **not** expect a datastore or an identity model — you implement
`ScimUserRepository` and `ScimGroupRepository` over your own tables, and the filter arrives as a
parsed AST for you to translate.

## Install

```bash
pnpm add @maroonedsoftware/scim koa @koa/router
```

Peers: `koa`, `@koa/router`. Runtime dependencies: `@maroonedsoftware/authentication`,
`@maroonedsoftware/errors`, `@maroonedsoftware/koa`, `@maroonedsoftware/logger`,
`@maroonedsoftware/utilities`, `injectkit`, `luxon`.

## Position in the graph

- **Depends on:** `authentication`, `errors`, `koa`, `logger`, `utilities`.
- **Depended on by:** nothing internal.
- **Subpath exports:** none. The package has no `exports` map at all.

Unlike the chat packages, this one **does** depend on `koa` — it ships a router, and SCIM's wire
contract is inseparable from HTTP.

## API surface

### Resource types

| Export                                                                   | Kind                 | Notes                                                                                   |
| ------------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------- |
| `ScimCommonAttributes`                                                   | interface            | `id`, `externalId`, `schemas`, `meta` — the base every resource extends.                |
| `ScimMeta`                                                               | interface            | `resourceType`, `created`, `lastModified`, `location`, `version`.                       |
| `ScimUser`                                                               | interface            | `extends ScimCommonAttributes`. Plus `ScimUserName`, `ScimAddress`, `ScimUserGroupRef`. |
| `ScimGroup`                                                              | interface            | `extends ScimCommonAttributes`. Plus `ScimGroupMember`.                                 |
| `ScimEnterpriseUser`                                                     | interface            | The enterprise extension.                                                               |
| `ScimMultiValuedAttribute<TValue>`                                       | interface            | Emails, phone numbers, and the rest.                                                    |
| `ScimListResponse<TResource>` / `ListResponseSchema`                     | interface / constant | The list envelope.                                                                      |
| `ScimPatchOp` / `ScimPatchRequest` / `ScimPatchOpKind` / `PatchOpSchema` | —                    | The PATCH request shape.                                                                |

### Schemas and discovery

| Export                                                                                                             | Kind       | Notes                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------- |
| `userSchema`, `groupSchema`, `enterpriseUserSchema`                                                                | constants  | `ScimSchema` definitions served by `/Schemas`.             |
| `coreSchemas`                                                                                                      | constant   | All three together.                                        |
| `userResourceType`, `groupResourceType`                                                                            | constants  | `ScimResourceType` definitions served by `/ResourceTypes`. |
| `UserSchemaId`, `GroupSchemaId`, `EnterpriseUserSchemaId`, `ResourceTypeSchemaId`, `ServiceProviderConfigSchemaId` | constants  | URN identifiers.                                           |
| `ScimSchema`, `ScimAttributeDefinition`, `ScimResourceType`                                                        | interfaces | Schema metadata shapes.                                    |
| `buildServiceProviderConfig`                                                                                       | function   | Builds the `/ServiceProviderConfig` document.              |
| `ScimServiceProviderConfig` / `…Options` / `ScimAuthenticationScheme`                                              | interfaces | —                                                          |

### Filter

| Export                        | Kind     | Shape                                                                               | Notes                               |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| `tokenizeScimFilter`          | function | `(input: string) => ScimToken[]`                                                    | —                                   |
| `parseScimFilter`             | function | `(input: string) => ScimFilterNode`                                                 | The full RFC 7644 §3.4.2.2 grammar. |
| `ScimFilterNode`              | type     | `ScimFilterComparison \| ScimFilterLogical \| ScimFilterNot \| ScimFilterValuePath` | The AST.                            |
| `ScimComparisonOperator`      | type     | `eq`, `ne`, `co`, `sw`, `ew`, `gt`, `ge`, `lt`, `le`, `pr`                          | —                                   |
| `ScimLogicalOperator`         | type     | `and`, `or`                                                                         | —                                   |
| `ScimToken` / `ScimTokenKind` | type     | Tokenizer output                                                                    | —                                   |

### PATCH

| Export           | Kind     | Shape                         | Notes                                                       |
| ---------------- | -------- | ----------------------------- | ----------------------------------------------------------- |
| `applyScimPatch` | function | `(resource, ops) => resource` | `add` / `replace` / `remove`, including value-path filters. |

### Errors

| Export            | Kind       | Shape                                                       | Notes                                        |
| ----------------- | ---------- | ----------------------------------------------------------- | -------------------------------------------- |
| `ScimError`       | class      | `extends HttpError`                                         | So `errorMiddleware` already understands it. |
| `scimError`       | function   | `(status, scimType?, detail?) => ScimError`                 | The factory to use.                          |
| `IsScimError`     | type guard | —                                                           | —                                            |
| `ScimErrorType`   | type       | `'invalidFilter'`, `'insufficientScope'`, `'mutability'`, … | RFC 7644 §3.12 `scimType` values.            |
| `ScimErrorSchema` | constant   | The error envelope URN                                      | —                                            |

### Repositories and services

| Export                                                                | Kind           | Notes                                                                                                                                               |
| --------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScimUserRepository`                                                  | abstract class | Implement over your datastore.                                                                                                                      |
| `ScimGroupRepository`                                                 | abstract class | Implement over your datastore.                                                                                                                      |
| `ScimListQuery`                                                       | interface      | `{ filter?: ScimFilterNode; startIndex; count; sortBy?; sortOrder?; attributes?; excludedAttributes? }` — **the parsed AST**, never the raw string. |
| `ScimListResult<TResource>`                                           | interface      | `{ resources; totalResults }` — `totalResults` is the **filter-matching total**, not the page size.                                                 |
| `ScimSortOrder`                                                       | type           | `'ascending' \| 'descending'`                                                                                                                       |
| `ScimUserService` / `ScimGroupService` / `ScimServiceProviderService` | class          | Sit between the router and the repositories.                                                                                                        |

### Middleware and router

| Export                      | Kind      | Shape                                                                              | Notes                                                                                 |
| --------------------------- | --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `scimErrorMiddleware`       | function  | `() => ServerKitMiddleware`                                                        | **Replaces** `errorMiddleware()` on the SCIM mountpoint.                              |
| `scimContentTypeMiddleware` | function  | `() => ServerKitMiddleware`                                                        | Enforces `application/scim+json`.                                                     |
| `SCIM_MEDIA_TYPE`           | constant  | `'application/scim+json'`                                                          | —                                                                                     |
| `requireScimScope`          | function  | `(scope: string) => ServerKitRouterMiddleware`                                     | Reads `ctx.authenticationSession.claims.scimScopes`. `*` grants everything.           |
| `createScimRouter`          | function  | `(options: CreateScimRouterOptions) => Router<unknown, ServerKitContext>`          | Mounts every endpoint below.                                                          |
| `CreateScimRouterOptions`   | interface | `{ userService, groupService, serviceProviderService, routeGuards?, maxResults? }` | `maxResults` defaults to the service-provider config's `filter.maxResults`, then 200. |

Endpoints mounted: `GET|POST /Users`, `GET|PUT|PATCH|DELETE /Users/:id`, `POST /Users/.search`, the
same six plus `.search` for `/Groups`, and `GET /Schemas`, `/Schemas/:id`, `/ResourceTypes`,
`/ResourceTypes/:id`, `/ServiceProviderConfig`.

## Canonical usage

```typescript
import {
  createScimRouter,
  requireScimScope,
  scimErrorMiddleware,
  ScimUserService,
  ScimGroupService,
  ScimServiceProviderService,
  ScimUserRepository,
  type ScimListQuery,
  type ScimListResult,
  type ScimUser,
} from '@maroonedsoftware/scim';

class PostgresScimUserRepository extends ScimUserRepository {
  async list(query: ScimListQuery): Promise<ScimListResult<ScimUser>> {
    // query.filter is a parsed AST — translate it to SQL
    const where = compileFilter(query.filter);
    const [rows, total] = await Promise.all([this.db.page(where, query.startIndex, query.count), this.db.count(where)]);
    return { resources: rows.map(toScimUser), totalResults: total };
  }
  // …the rest of the abstract methods
}

const router = createScimRouter({
  userService: new ScimUserService(userRepository, logger),
  groupService: new ScimGroupService(groupRepository, logger),
  serviceProviderService: new ScimServiceProviderService(config),
  routeGuards: [requireScimScope('scim:write')],
});

// SCIM mountpoint — note scimErrorMiddleware, not errorMiddleware
app.use(scimErrorMiddleware());
app.use(serverKitContextMiddleware(container));
app.use(authenticationMiddleware());
app.use(router.routes()).use(router.allowedMethods());
```

## Rules for generated code

- Use `scimErrorMiddleware()` on the SCIM mountpoint instead of `errorMiddleware()`. SCIM has its
  own error envelope, and the default middleware renders the ServerKit one.
- The mountpoint still needs `serverKitContextMiddleware` and `authenticationMiddleware`, in that
  order, before the router.
- Translate `query.filter` — the AST — into your datastore's query language. You never see the raw
  filter string, which is the point.
- Return the **filter-matching total** in `ScimListResult.totalResults`, not the page length.
  Provisioning clients paginate on it, and a wrong value makes Okta or Entra loop or truncate.
- Populate `claims.scimScopes` (a string array) when minting the bearer session, or every request
  gets a 403.
- Honour `startIndex` as **1-based**, per RFC 7644 §3.4.2.4. Off-by-one here silently skips or
  repeats the first record.
- Apply PATCH with `applyScimPatch` rather than hand-rolling op semantics — value-path filters
  (`emails[type eq "work"].value`) are easy to get subtly wrong.
- Throw `scimError(status, scimType, detail)` with the right RFC 7644 §3.12 `scimType`. Clients
  branch on it.
- Serve `/Schemas`, `/ResourceTypes`, and `/ServiceProviderConfig`. Provisioning clients call them
  during setup and fail the connection without them.

## Gotchas

- **`requireScimScope` grants everything on a `*` scope.** A session minted with
  `scimScopes: ['*']` bypasses every per-route check. Convenient in development, dangerous if it
  reaches a production token.
- **Missing or malformed `scimScopes` is a 403, not a 500.** A non-array value (a string, say) fails
  the `Array.isArray` check and denies, so a config mistake looks like a permissions problem.
- **`routeGuards` applies to every route uniformly**, including the discovery endpoints. There is no
  per-route scope distinction built in — `requireScimScope('users:read')` in `routeGuards` also
  gates `/Groups` and `/ServiceProviderConfig`. For finer control, mount more than one router.
- **`.search` endpoints exist because filters outgrow a query string.** `POST /Users/.search` takes
  the same parameters in the body. Provisioning clients use it for large filters; omitting it means
  those requests 404.
- **`maxResults` has a three-level fallback**: the option, then the service-provider config's
  `filter.maxResults`, then 200. A client asking for more is capped silently.
- **`ScimError extends HttpError`**, so it flows through the standard ServerKit error path as well —
  but only `scimErrorMiddleware` renders the SCIM envelope.
- **The body parser accepts both `application/scim+json` and `application/json`.** Real clients send
  the former; being lenient avoids a class of integration failures, but it means
  `scimContentTypeMiddleware` is what actually enforces the media type if you want strictness.
- **`schemas` on a resource is a required array of URNs**, not decoration. Omitting the enterprise
  URN on a user with enterprise attributes makes clients ignore them.

## Working inside this package

```
src/
  index.ts                 Root barrel (re-exports every folder's index)
  types/                   scim.meta, scim.user, scim.group, list.response, patch.op
  schemas/                 user, group, enterprise.user, resource.type,
                           service.provider.config, schema.types
  filter/                  filter.tokenizer, filter.parser, filter.ast
  patch/                   patch.applier
  errors/                  scim.error
  repositories/            scim.user.repository, scim.group.repository, repository.types
  services/                scim.user.service, scim.group.service, scim.service.provider.service
  middleware/              require.scim.scope, scim.content.type, scim.error
  router/                  scim.router
```

Every folder has its own `index.ts`; the root barrel re-exports those. Tests are in `tests/`,
mirroring `src/`.

Invariants a change must not break:

- Repositories receive the **parsed AST**, never the raw filter string. That is what keeps backend
  translation the only concern a consumer has.
- `totalResults` is the filter-matching total. Provisioning clients' pagination depends on it.
- `startIndex` is 1-based throughout.
- The SCIM error envelope (`ScimErrorSchema`, `scimType`, `detail`) is a wire contract with Okta,
  Entra ID, and every other provisioning client. It is not ServerKit's error shape.
- The filter grammar and the PATCH value-path semantics follow RFC 7644. Divergence shows up as an
  integration failure at a customer, not as a test failure here.
- `koa` is a legitimate dependency here (this package ships a router), unlike in the chat packages.

User-visible changes need a changeset in `.changeset/`.
