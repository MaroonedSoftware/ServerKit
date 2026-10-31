---
'@maroonedsoftware/johnny5': patch
---

Document that the `./bin` TypeScript loader needs `typescript` 6.x. `@swc-node/register` crashes on TypeScript 7 because it depends on the classic compiler API. The other `johnny5` entry points are unaffected.
