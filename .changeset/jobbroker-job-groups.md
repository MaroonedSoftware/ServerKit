---
'@maroonedsoftware/jobbroker': minor
---

Add job groups. `JobSendOptions.group` (`{ id, tier? }`) puts a job in a group, and `JobWorkerPolicy.groupConcurrency` limits how many jobs of one group run at once across every node, so one key's jobs run one at a time while other keys run in parallel. The pg-boss backend passes them through as pg-boss's `group` job option and `groupConcurrency` work option, and `groupConcurrency` merges through `defaultWorkerPolicy` like the other worker fields.
