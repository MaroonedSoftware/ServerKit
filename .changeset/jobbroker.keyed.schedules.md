---
'@maroonedsoftware/jobbroker': minor
---

Keep many schedules on one queue, each with its own key, time zone and recurrence.

- `JobBroker.schedule(name, recurrence, payload?, options?)` accepts an RFC 5545 recurrence rule (for example `FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=0`) as well as a cron expression, and takes a new `JobScheduleOptions` of `{ key?, timeZone?, missed?: 'skip' | 'once' }`. A job name holds one schedule per key, and scheduling again with the same key replaces it.
- `JobBroker.unschedule(name, key?)` removes the schedule with that key. Without a key it removes only the unkeyed schedule, as before.
- New `JobBroker.getSchedules(name, key?)` returns `JobSchedule { name, key, recurrence, timeZone, payload? }[]`.
- New `JobBroker.previewSchedule(recurrence, { timeZone?, from?, count? })` returns the next occurrences as Luxon `DateTime`s without storing anything.
- `PgBossJobBroker.unschedule` now runs on the `PgBossConnectionProvider` executor, so an unschedule inside a transaction rolls back with it.
- The optional `pg-boss` peer now requires `^12.38.0`.

Calls without the new arguments behave as they did. Custom `JobBroker` subclasses must implement `getSchedules` and `previewSchedule` (throwing `NotSupportedError` is allowed).
