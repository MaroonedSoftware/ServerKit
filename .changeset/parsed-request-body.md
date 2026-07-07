---
'@maroonedsoftware/koa': minor
'@maroonedsoftware/scim': patch
---

**Breaking (koa):** the parsed request body is now assigned to `ctx.parsedBody` instead of `ctx.body`.

In Koa, `ctx.body` is the _response_ body. Writing the parsed request payload there caused it to be echoed back to the client on any handler path that returned without overwriting `ctx.body` (e.g. an early return, a 204, or a validate-then-fall-through). `bodyParserMiddleware` now writes the parsed value to the new `ctx.parsedBody` field (raw bytes remain on `ctx.rawBody`), leaving `ctx.body` solely for the response.

Migration: read request input from `ctx.parsedBody` instead of `ctx.body` in route handlers:

```diff
- const body = ctx.body as CreateUserDto;
+ const body = ctx.parsedBody as CreateUserDto;
```

`scim`: the internal `takeRequestBody` helper now reads `ctx.parsedBody`; no public API change.
