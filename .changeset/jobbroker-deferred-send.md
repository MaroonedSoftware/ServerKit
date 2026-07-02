---
'@maroonedsoftware/jobbroker': minor
---

Add deferred job enqueueing to `JobBroker.send` via an optional `JobSendOptions` argument. Pass `startAfter` as a Luxon `Duration` (relative delay) or `DateTime` (absolute earliest-run time) to defer a job instead of running it immediately. The pg-boss backend maps this onto its native `startAfter` (a `Duration` becomes relative seconds, a `DateTime` becomes an absolute `Date`); the option is expressed as intent so future backends (SQS `DelaySeconds`, Cloud Tasks `scheduleTime`) can map it too and throw `NotSupportedError` for delays they cannot honor.
