---
"@maroonedsoftware/slack": patch
---

Move `luxon` from `devDependencies` to `dependencies`. `slack.signature.ts` imports `luxon` at runtime, so it must be a regular dependency — it previously resolved only via workspace hoisting and would be missing for an isolated/published consumer.
