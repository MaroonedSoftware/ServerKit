# @maroonedsoftware/policies

A small, DI-friendly policy framework for ServerKit. Encode allow/deny rules as named, injectable `Policy` classes; resolve them at call sites through a typed `PolicyService`.

## Installation

```bash
pnpm add @maroonedsoftware/policies
```

## Features

- **`Policy` base class** — implement a single `evaluate` method and return `allow()`, `deny(reason, details?, internalDetails?)`, or `denyStepUp(reason, requirement)`
- **Typed `PolicyResult`** — discriminated union with `isPolicyResultAllowed` / `isPolicyResultDenied` guards; denial results carry `details` (rendered to clients) and `internalDetails` (log-only)
- **Named registry** — register each policy under a stable name (e.g. `'email.allowed'`) so callers depend on the name and `PolicyService`, not on concrete classes
- **Type-safe call sites** — declare a `Policies` map (`{ <name>: <ContextShape> }`) and `BasePolicyService.check`/`assert` enforce the right context per name at compile time
- **Per-evaluation envelope** — subclass `BasePolicyService` to attach request-scoped state (current time, session, request id, …) without each policy reaching for it
- **Fluent step-up denials** — `denyStepUp(reason, { within, acceptableMethods, … })` bundles a `StepUpRequirement` into the response under `kind: 'step_up_required'`
- **Built-in test doubles** — `AlwaysAllowPolicy` / `AlwaysDenyPolicy` swap in under any policy name to bypass or force a rule in tests without touching the code under test

## Concepts

- A **policy** is a single rule that takes a context and returns `PolicyResult`.
- The **registry** (`PolicyRegistryMap`) maps a stable string name to the DI identifier of the policy class.
- The **policy service** (`PolicyService`) is the abstract handle call sites depend on; `BasePolicyService` is the default implementation that pulls each policy from the DI container and supplies it with a fresh envelope.
- An **envelope** (`PolicyEnvelope`) is the per-evaluation context shared across all policies — at minimum `now: DateTime`. Subclass to add session, request id, etc.

## Usage

### Define a policy

```ts
import { Injectable } from 'injectkit';
import { Policy, PolicyResult, PolicyEnvelope } from '@maroonedsoftware/policies';

interface EmailAllowedContext {
  value: string;
}

@Injectable()
class EmailAllowedPolicy extends Policy<EmailAllowedContext> {
  async evaluate(context: EmailAllowedContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    if (!context.value.includes('@')) return this.deny('invalid_format');
    if (context.value.endsWith('@disposable.com')) return this.deny('deny_list');
    return this.allow();
  }
}
```

### Wire up a `PolicyService` in your app

```ts
import { BasePolicyService, PolicyEnvelope, PolicyRegistryMap, PolicyService } from '@maroonedsoftware/policies';
import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';

type AppPolicies = {
  'email.allowed': { value: string };
  'phone.allowed': { value: string };
};

@Injectable()
class AppPolicyService extends BasePolicyService<AppPolicies> {
  protected async buildEnvelope(): Promise<PolicyEnvelope> {
    return { now: DateTime.utc() };
  }
}

// At bootstrap:
registry.register(EmailAllowedPolicy).useClass(EmailAllowedPolicy).asSingleton();
registry.register(PolicyRegistryMap).useFactory(() => {
  const map = new PolicyRegistryMap();
  map.set('email.allowed', EmailAllowedPolicy);
  return map;
});
registry.register(PolicyService).useClass(AppPolicyService).asSingleton();
```

### Evaluate at call sites

```ts
const policyService = container.get(PolicyService);

// `check` returns the discriminated result — branch on `allowed`.
const result = await policyService.check('email.allowed', { value: 'user@example.com' });
if (!result.allowed) {
  throw httpError(400).withDetails({ value: result.reason });
}

// `assert` throws HTTP 403 on deny. The denial result is split across the thrown error:
// - `result.details` (client-facing) → `HttpError.details`, rendered to the response body.
// - `result.internalDetails` (operator/log-only) → `HttpError.internalDetails`, merged with
//   framework context (`policyName`, `reason`, `kind: 'policy_violation'`), never on the wire.
// - `result.headers` → `HttpError.withHeaders`, attached to the HTTP response.
await policyService.assert('email.allowed', { value: 'user@example.com' });
```

### Step-up denials

When a policy needs proof of recent re-authentication, return a step-up denial. The bundled `StepUpRequirement` is serialised under `details.stepUp` so clients can drive the user through a re-auth challenge before retrying:

```ts
return this.denyStepUp('recent_auth_required', {
  within: Duration.fromObject({ minutes: 5 }),
  acceptableMethods: ['fido', 'authenticator'],
});
```

### Response headers on deny

`deny(...)` and `denyStepUp(...)` return a `PolicyDenialBuilder` with a fluent `.withHeaders(headers)` setter. `BasePolicyService.assert` forwards them to `HttpError.withHeaders` so the response carries them. Use for `WWW-Authenticate` on auth/MFA policies, `Retry-After` on rate-limit policies, etc.:

```ts
return this.deny('mfa_required').withHeaders({ 'WWW-Authenticate': 'Bearer error="mfa_required"' });

return this.denyStepUp('aal2_required', { within: Duration.fromObject({ minutes: 15 }) }).withHeaders({
  'WWW-Authenticate': 'Bearer error="aal2_required"',
});
```

### Bypassing a policy in tests

Because every call site resolves policies by _name_ through `PolicyService`, rebinding the name in the registry overrides the rule everywhere it is evaluated — no seams needed in the code under test. `AlwaysAllowPolicy` and `AlwaysDenyPolicy` are shipped for exactly this:

```ts
import { AlwaysAllowPolicy, PolicyRegistryMap } from '@maroonedsoftware/policies';

registry.register(AlwaysAllowPolicy).useClass(AlwaysAllowPolicy).asSingleton();
registry.register(PolicyRegistryMap).useFactory(() => {
  const map = new PolicyRegistryMap();
  Object.entries(AuthenticationPolicyMappings).forEach(([name, policy]) => map.set(name, policy));

  // Override after the defaults are spread — last write wins.
  if (config.bypassMfa) map.set('auth.session.mfa.required', AlwaysAllowPolicy);
  return map;
});
```

Two things to keep in mind:

- **"Allow" is not uniformly the permissive direction.** A denial from `'auth.session.mfa.required'` means _MFA is required_, so always-allow skips the challenge; an allow from `'auth.session.mfa.satisfied'` asserts the session has _already_ stepped up. Check which way the policy reads, and gate the binding behind a flag that cannot be set in production.
- **`AlwaysDenyPolicy` carries no payload.** It denies with `reason: 'always_deny'` and no `details` / `internalDetails` / `headers`. That is exact for `assert` call sites, but callers that branch on the denial payload degrade instead of failing cleanly — write a purpose-built stub when the shape of the denial matters.

## API

### `Policy<Context, Envelope>`

Abstract base class. Subclass and implement `evaluate(context, envelope): Promise<PolicyResult>`.

| Helper                                     | Returns                                                 | Description                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allow()`                                  | `{ allowed: true }`                                     | Allow the request                                                                                                                                                                                                                                                          |
| `deny(reason, details?, internalDetails?)` | `PolicyDenialBuilder` (implements `PolicyResultDenied`) | Deny with a machine-readable reason. `details` is rendered to the HTTP response by `assert`; `internalDetails` lands in the thrown error's `internalDetails` (logs only, never on the wire). Chain `.withHeaders({...})` to attach HTTP headers (e.g. `WWW-Authenticate`). |
| `denyStepUp(reason, requirement)`          | `PolicyDenialBuilder`                                   | Deny and attach a `StepUpRequirement` clients can use to drive a re-auth challenge. Chain `.withHeaders({...})` to attach response headers.                                                                                                                                |

### `PolicyService`

Abstract DI handle. Implementations supply a per-evaluation envelope.

| Method                        | Returns                 | Description                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check(policyName, context)`  | `Promise<PolicyResult>` | Resolve the registered policy and return its result. Throws when `policyName` is not registered.                                                                                                                                                                                                                  |
| `assert(policyName, context)` | `Promise<void>`         | Same as `check`, but throws HTTP 403 on deny. `result.details` is surfaced under `HttpError.details`; `result.internalDetails` is merged with framework context (`policyName`, `reason`, `kind: 'policy_violation'`) under `HttpError.internalDetails`; `result.headers` is forwarded to `HttpError.withHeaders`. |

### `BasePolicyService<TPolicies, TEnvelope>`

Default `PolicyService`. Subclass and implement `buildEnvelope(): Promise<TEnvelope>`. The `TPolicies` type parameter ties policy names to their context shape, giving call sites compile-time type safety.

### `PolicyRegistryMap`

`Map<string, Identifier<Policy>>`. Populate at bootstrap to bind each policy name to its DI identifier.

### Test doubles

| Policy              | Result                                      | Description                                                                                                                  |
| ------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `AlwaysAllowPolicy` | `{ allowed: true }`                         | Allows every request. Bind under a policy name to bypass the real rule for every call site that resolves it.                 |
| `AlwaysDenyPolicy`  | `{ allowed: false, reason: 'always_deny' }` | Denies every request with no `details` / `internalDetails` / `headers`. Bind under a policy name to force the denial branch. |

### Types

| Type                  | Shape                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PolicyResultAllowed` | `{ allowed: true }`                                                                                                                                  |
| `PolicyResultDenied`  | `{ allowed: false; reason: string; details?: Record<string, unknown>; internalDetails?: Record<string, unknown>; headers?: Record<string, string> }` |
| `PolicyResult`        | `PolicyResultAllowed \| PolicyResultDenied`                                                                                                          |
| `PolicyEnvelope`      | `{ now: DateTime }` (extend in subclasses)                                                                                                           |
| `StepUpRequirement`   | `{ within: Duration; acceptableMethods?; acceptableKinds?; excludeMethods? }`                                                                        |

| Guard                      | Description                        |
| -------------------------- | ---------------------------------- |
| `isPolicyResultAllowed(r)` | Narrows `r` to the allowed branch. |
| `isPolicyResultDenied(r)`  | Narrows `r` to the denied branch.  |

## License

MIT — see [LICENSE](./LICENSE).
