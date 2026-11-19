---
'@maroonedsoftware/jobbroker': patch
---

Recommend `groupConcurrency` for keeping a group's jobs from overlapping across nodes. With pg-boss 12.38.1 and later it holds under simultaneous fetches, so the docs no longer call it approximate. `localGroupConcurrency` is described as the in-process limit for a queue one node consumes.
