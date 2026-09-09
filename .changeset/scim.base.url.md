---
'@maroonedsoftware/scim': minor
---

Add a `baseUrl` option to `createScimRouter` so `meta.location` and the `Location` response header
carry a real resource URI. Both were hardcoded to a root-relative `/Users/{id}`, so any deployment
mounting the router under a prefix such as `/scim/v2` published locations that provisioning clients
follow to a 404. RFC 7643 §3.1 wants the resource URI.

Omitting the option keeps the previous root-relative behaviour. Also fixes the README quick start,
which passed `userRepository`, `groupRepository`, `basePath`, and `serviceProviderConfig` — none of
which are members of `CreateScimRouterOptions`.
