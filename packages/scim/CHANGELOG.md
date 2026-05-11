# @maroonedsoftware/scim

## 0.1.2

### Patch Changes

- Updated dependencies [47c201a]
- Updated dependencies [4f12151]
  - @maroonedsoftware/authentication@4.13.0
  - @maroonedsoftware/koa@2.1.15

## 0.1.1

### Patch Changes

- Updated dependencies [33fa7b0]
  - @maroonedsoftware/authentication@4.12.0
  - @maroonedsoftware/koa@2.1.14

## 0.1.0

### Minor Changes

- c5f98a6: Add `@maroonedsoftware/scim`, a SCIM 2.0 (RFC 7643/7644) server toolkit. Ships User, Group, and EnterpriseUser schemas, a typed filter parser, a PATCH applier, the SCIM error envelope, abstract `ScimUserRepository` / `ScimGroupRepository` contracts, and a `createScimRouter` factory that mounts the standard `/Users`, `/Groups`, `/Schemas`, `/ResourceTypes`, and `/ServiceProviderConfig` endpoints. Endpoint authentication integrates with `@maroonedsoftware/authentication` via a `requireScimScope(scope)` guard.
