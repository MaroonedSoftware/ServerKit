---
'@maroonedsoftware/jobbroker': minor
---

`PgBossJobRunner` now runs each job execution in its own scoped container instead of resolving jobs from the root container.

Previously every job was resolved directly off the injected root container. Because InjectKit caches a `scoped` registration in whichever container first resolves it, and child scopes inherit a parent's cache, a scoped dependency reached through a job became a process-lifetime singleton shared by every job execution, and was then inherited by every scope created from the root afterwards, including the per-request scopes from `serverKitContextMiddleware`. An `AppConfigSection` injected into a job, for example, froze its `.value` snapshot at the first job run and leaked that stale snapshot into subsequent requests.

Each item in a batch now resolves from a scope created via `container.createScopedContainer()`, disposed once that item settles. This makes `asScoped()` registrations behave per job execution (the job-side equivalent of a request scope) and releases container-owned disposables that previously accumulated on the root for the lifetime of the process. A disposal failure is logged rather than rethrown, so it cannot mask the job's own outcome or trigger a spurious retry.

This changes behavior for anything that was relying on the accidental sharing: a `scoped` dependency that was effectively a singleton across jobs is now constructed per execution. Registrations that should genuinely be shared process-wide should be `asSingleton()`.

Adds a `JobContext` injection token, registered in each execution's scope, so a job or any of its collaborators can inject the job currently running (`id`, `name`, the cancellation `signal`, and `expiresIn` when the backend reports one) instead of threading that metadata through by hand. Call the new `registerJobContext(registry)` before `build()` whenever a registered service injects it: `Registry.build()` validates the dependency graph up front, and the runner's per-execution override only exists at runtime. Resolving `JobContext` outside a job execution throws rather than returning a stale context.

A failure to resolve the job from the container is now logged like any other job failure, and its scope is disposed. Previously it rejected the batch item unlogged.
