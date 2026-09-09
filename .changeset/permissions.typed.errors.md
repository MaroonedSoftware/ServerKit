---
'@maroonedsoftware/permissions': minor
---

Raise a typed `PermissionsError` for an unknown namespace or relation, and let callers tell a
denial from a depth-capped answer.

`AuthorizationModel.resolve` threw a plain `Error`, so a misspelt permission name at a call site
was indistinguishable from any other failure. It now throws `PermissionsError` carrying a `code`
of `'unknown_namespace'`, `'unknown_relation'`, or `'subject_not_allowed'`, with an
`IsPermissionsError` guard.

Adds `checkDetailed`, which returns `{ allowed, maxDepthExceeded, metrics }`. Exceeding the depth
cap made `check` return `false`, indistinguishable from a real denial; `maxDepthExceeded` separates
"could not determine" from "denied". `check` is unchanged.
