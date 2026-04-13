---
'@maroonedsoftware/jobbroker': minor
---

Call and await this.pgboss.start() at the beginning of PgBossJobRunner.start() to ensure the pgboss instance is running before calling getQueue/createQueue.
