---
'@maroonedsoftware/jobbroker': patch
---

Require pg-boss 12.38.2. Before 12.38.1, workers that fetched at the same moment could each claim a job of one group and run the group past its `groupConcurrency`. 12.38.2 also stops maintenance from deleting a job that is waiting for its retry.
