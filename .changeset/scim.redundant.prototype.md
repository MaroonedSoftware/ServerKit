---
'@maroonedsoftware/scim': patch
---

Stop `ScimError` pinning its own prototype, so subclasses keep working `instanceof`.

The constructor ended with `Object.setPrototypeOf(this, ScimError.prototype)`, a workaround for
`HttpError` doing the same thing one level up. With that fixed in `@maroonedsoftware/errors`, the line
is not just redundant — it carries the identical bug for anyone extending `ScimError`, since it
overwrites the prototype `ServerkitError` restores from `new.target`:

```typescript
class TenantScimError extends ScimError {}
new TenantScimError(409) instanceof TenantScimError; // was false, now true
```

`new ScimError(...)` and `scimError(...)` are unaffected — `new.target` already resolved to `ScimError`
for those, which is why the workaround appeared to be doing its job.
