---
'@maroonedsoftware/johnny5': minor
---

Add detached-process support to johnny5:

- `Shell.runDetached(command, args, { logFile?, cwd?, env? })` — low-level primitive that spawns a child with `detached: true` + `unref()`, optionally appending stdout/stderr to a log file. Returns `{ pid, logFile }` immediately so the CLI process can exit.
- `ctx.daemons` — project-scoped manager built on `runDetached`. Owns pid- and log-file conventions: `start` is idempotent (`onExisting: 'reuse' | 'restart' | 'error'`), `stop` sends a signal and cleans the pid file, `status` and `list` read the on-disk records and verify liveness via `process.kill(pid, 0)`. Daemon names must match `/^[A-Za-z0-9._-]+$/`. `createDaemons` accepts an optional `paths` override (`JohnnyPaths`) for tests and consumers that need an isolated runtime/log location.
- `johnnyPaths(app)` — returns OS-native `{ log, runtime, cache }` dirs (macOS `~/Library/Logs|Caches`, Linux XDG, Windows `%LOCALAPPDATA%`).
- `projectSlug(projectRoot)` — `<basename>-<8charHash>` slug used to scope pid/log dirs per checkout, so two clones of the same repo don't collide.

Pid files live under `<johnnyPaths.runtime>/<slug>/`, logs under `<johnnyPaths.log>/<slug>/`.
