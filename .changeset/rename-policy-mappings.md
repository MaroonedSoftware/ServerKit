---
'@maroonedsoftware/authentication': minor
---

Rename `PolicyMappings`, `PolicyNames`, and `PolicyContexts` to `AuthenticationPolicyMappings`, `AuthenticationPolicyNames`, and `AuthenticationPolicyContexts` so they don't collide when an application bundles policy mappings from multiple `@maroonedsoftware/*` packages.

Migration: rename references at every import site. The runtime values and context shapes are unchanged.
