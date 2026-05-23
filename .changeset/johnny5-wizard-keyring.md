---
'@maroonedsoftware/johnny5': minor
---

Add `wizard` session wrapper and an optional `@maroonedsoftware/johnny5/keyring` subpath.

`wizard(ctx, options, body)` runs a multi-step interactive flow with uniform intro/outro framing and cancel handling. The session passed to `body` exposes `confirm` / `text` / `password` / `select` / `multiselect` (plus `log` and `spinner` pass-throughs) whose answers are already unwrapped — cancellation throws `PromptCancelledError`, which the wrapper catches and renders as a configurable cancel outro plus exit code. Eliminates the `if (clack.isCancel(x)) { clack.outro('aborted'); return 1; }` boilerplate that piles up in every guided command.

`@maroonedsoftware/johnny5/keyring` ships `keyringEntry(ctx, { service, account })` for safe read/write/delete against the OS keyring, plus `resolveSecret(ctx, options)` which codifies the override → env → keyring → prompt resolution chain. The peer dependency on `@napi-rs/keyring` is optional and lazy-loaded — CLIs that don't need keyring access pay no install or bundle cost, and CLIs that do degrade gracefully (logging a one-shot warning and returning `null` / `false`) when the native module isn't installed. `resolveSecret` never calls `process.exit`; callers own the missing-credential policy.
