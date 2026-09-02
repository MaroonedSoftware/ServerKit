---
'@maroonedsoftware/mcp': patch
---

Fix the Koa route example in the MCP docs: it read the request payload from `ctx.request.body`, which ServerKit never populates, and omitted the `bodyParserMiddleware` call that actually fills `ctx.parsedBody` and `ctx.rawBody`. The example now parses the body and dispatches `ctx.parsedBody` in both session modes.
