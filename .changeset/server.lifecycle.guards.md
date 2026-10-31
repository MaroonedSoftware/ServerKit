---
'@maroonedsoftware/servercore': minor
---

Harden the shutdown path. A `shutdown` hook that throws no longer skips the hooks after it. Add opt-in `shutdownBudgetMs` (one limit on the whole shutdown), `gracefulCrash` (an orderly close and exit code 1 on `uncaughtException` and `unhandledRejection`), and `readyRequired` on a module (a failed `ready` hook closes the server). Add a public `close()` that starts the same orderly close as `SIGTERM`.
