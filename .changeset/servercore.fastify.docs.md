---
'@maroonedsoftware/servercore': patch
---

Update the documentation that named the Fastify adapter's body parsing. The shared body gate and
parser mappings are now used by `bodyParserPlugin` on Fastify, not a `bodyParserMiddleware`. No
runtime change.
