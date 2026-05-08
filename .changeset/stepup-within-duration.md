---
'@maroonedsoftware/policies': minor
---

Reshape `StepUpRequirement.withinSeconds: number` to `StepUpRequirement.within: Duration` so step-up windows are expressed in the same Luxon `Duration` shape used everywhere else in ServerKit (factor expirations, session TTLs, …) and don't require callers to convert between units at the call site.

Migration: replace `withinSeconds: 300` with `within: Duration.fromObject({ minutes: 5 })` (or any equivalent `Duration`).
