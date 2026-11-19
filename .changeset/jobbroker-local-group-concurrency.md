---
'@maroonedsoftware/jobbroker': minor
---

Add `JobWorkerPolicy.localGroupConcurrency`, mapped to pg-boss's `localGroupConcurrency`: an exact per-group limit counted by the node's own workers, so a group's jobs never overlap on that node. It is now the documented way to keep one key's jobs in order. `groupConcurrency` is counted in the database and spans nodes, but two workers fetching at once can both start a job from the same group, so the docs now describe it as a load bound rather than an ordering guarantee. A queue whose merged worker policy sets both now fails at `runner.start()` with an error naming the queue, before anything is created or started.
