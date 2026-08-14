---
'@maroonedsoftware/appconfig': patch
'@maroonedsoftware/authentication': patch
'@maroonedsoftware/cache': patch
'@maroonedsoftware/comms': patch
'@maroonedsoftware/discord': patch
'@maroonedsoftware/encryption': patch
'@maroonedsoftware/errors': patch
'@maroonedsoftware/eventbus': patch
'@maroonedsoftware/jobbroker': patch
'@maroonedsoftware/johnny5': patch
'@maroonedsoftware/koa': patch
'@maroonedsoftware/kysely': patch
'@maroonedsoftware/logger': patch
'@maroonedsoftware/mcp': patch
'@maroonedsoftware/multipart': patch
'@maroonedsoftware/permissions': patch
'@maroonedsoftware/permissions-dsl': patch
'@maroonedsoftware/policies': patch
'@maroonedsoftware/scim': patch
'@maroonedsoftware/serverfeed': patch
'@maroonedsoftware/slack': patch
'@maroonedsoftware/storage': patch
'@maroonedsoftware/telegram': patch
'@maroonedsoftware/utilities': patch
'@maroonedsoftware/whatsapp': patch
'@maroonedsoftware/zod': patch
---

Ship `AGENTS.md` in the published tarball.

Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
coding agents covering the full export surface, canonical wiring, package-specific rules, and the
non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
`node_modules` without a network round-trip.

No runtime code changed.
