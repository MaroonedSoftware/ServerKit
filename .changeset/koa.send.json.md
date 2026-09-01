---
'@maroonedsoftware/koa': minor
---

New `sendJson(ctx, serialized, status?)` helper for writing a pre-serialized JSON string as the response body. Koa infers `text/plain` for a string body unless a content type was set explicitly, so assigning compiled-serializer output to `ctx.body` directly ships the wrong content type — this helper sets `application/json` before the body and defaults the status to 200. It pairs with `compileSerializer` from `@maroonedsoftware/zod/serializer`, whose output skips Koa's own `JSON.stringify` pass entirely, but any pre-serialized JSON string works.
