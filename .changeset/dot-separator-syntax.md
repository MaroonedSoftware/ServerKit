---
'@maroonedsoftware/permissions': minor
'@maroonedsoftware/permissions-dsl': minor
---

Switch tuple and DSL syntax to use `.` instead of `#` for the relation
separator and `.*` instead of `:*` for wildcards. The structure is
otherwise identical to Zanzibar/SpiceDB form.

**Migration:** replace `#` with `.` and `:*` with `.*` everywhere they
appear in `.perm` files, stored tuple strings, validation fixtures, and
any code that calls `parseTuple` / `stringifyTuple` /
`parseSubject` / `formatSubject` / `parseSubjectType`.

Examples:

| Old                               | New                          |
| --------------------------------- | ---------------------------- |
| `document#owner` (DSL userset)    | `document.owner`             |
| `user:*` (DSL/tuple wildcard)     | `user.*`                     |
| `doc:d1#owner@user:alice` (tuple) | `doc:d1.owner@user:alice`    |
| `doc:d1#viewer@org:42#admin`      | `doc:d1.viewer@org:42.admin` |

Object ids now also reject the structural characters `.`, `:`, `@`, `*`
(via the Zod `IdSchema`) — they were never representable in canonical
tuple strings, and excluding them removes a class of parse ambiguity.
