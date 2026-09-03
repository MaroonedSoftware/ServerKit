---
'@maroonedsoftware/mcp': patch
---

Correct the JSDoc naming where a Fastify app's parsed JSON body comes from. It is now the ordinary
`request.body`, populated by the Fastify adapter's `bodyParserPlugin`, rather than
`request.parsedBody`. No runtime change.
