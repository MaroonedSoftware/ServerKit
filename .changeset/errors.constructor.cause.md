---
'@maroonedsoftware/errors': minor
---

Keep a `cause` passed through the constructor, and stop `HttpError` from breaking `instanceof` for its subclasses.

`new ServerkitError('x', { cause })` silently discarded the cause. `super(message, options)` sets the
native `Error.cause`, but the `cause` field declared on the class compiles to a `defineProperty` under
`useDefineForClassFields` (implied by `target: esnext`) that runs after the super call and overwrites it
with `undefined`. Only `withCause` worked; the constructor option had never done anything, on any
subclass. It is now re-assigned after `super`, which also keeps `cause` an own enumerable property so
anything that spreads or enumerates an error still sees it.

`HttpError` accepts the same options as a third parameter, forwarded to `super`, and `httpError()`
forwards them too:

```typescript
throw httpError(502, 'Bad Gateway', { cause: upstreamError });
```

`HttpError` also stopped pinning its own prototype. It ran `Object.setPrototypeOf(this, HttpError.prototype)`
after `super()`, overwriting the prototype `ServerkitError` had already restored from `new.target` — so
`class NotFound extends HttpError {}` produced instances where `x instanceof NotFound` was `false`, and
subclasses had to repeat the workaround to get it back. Inheriting is now enough. Existing subclasses
that still call `setPrototypeOf` keep working; the line is simply redundant, and should be removed if
anything ever subclasses _them_.
