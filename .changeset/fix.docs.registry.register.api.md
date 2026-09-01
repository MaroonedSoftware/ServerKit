---
'@maroonedsoftware/discord': patch
'@maroonedsoftware/mcp': patch
'@maroonedsoftware/slack': patch
'@maroonedsoftware/telegram': patch
'@maroonedsoftware/whatsapp': patch
---

Fix DI registration examples in READMEs and JSDoc to use the real injectkit API.

The examples showed `container.register(Token, { useValue: value })`, which does not exist:
injectkit's `Container` has no `register` method, and registration is fluent off the registry.
Every occurrence now reads `registry.register(Token).useValue(value)`, matching each package's
`AGENTS.md` and the wiring used in the test suites. Docs only, no runtime change.
