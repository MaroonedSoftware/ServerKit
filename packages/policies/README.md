# @maroonedsoftware/policies

A small, DI-friendly policy framework for ServerKit. Encode allow/deny rules as named, injectable `Policy` classes; resolve them at call sites through a typed `PolicyService`.

## Installation

```bash
pnpm add @maroonedsoftware/policies
```

## Features

- **`Policy` base class** — implement a single `evaluate` method and return `allow()`, `deny(reason, details?)`, or `denyStepUp(reason, requirement)`
- **Typed `PolicyResult`** — discriminated union (`{ allowed: true } | { allowed: false, reason, details? }`) with `isPolicyResultAllowed` / `isPolicyResultDenied` guards
- **Named registry** — register each policy under a stable name (e.g. `'email_allowed'`) so callers depend on the name and `PolicyService`, not on concrete classes
- **Type-safe call sites** — declare a `Policies` map (`{ <name>: <ContextShape> }`) and `BasePolicyService.check`/`assert` enforce the right context per name at compile time
- **Per-evaluation envelope** — subclass `BasePolicyService` to attach request-scoped state (current time, session, request id, …) without each policy reaching for it
- **Fluent step-up denials** — `denyStepUp(reason, { within, acceptableMethods, … })` bundles a `StepUpRequirement` into the response under `kind: 'step_up_required'`

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
  email_allowed: { value: string };
  phone_allowed: { value: string };
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
  map.set('email_allowed', EmailAllowedPolicy);
  return map;
});
registry.register(PolicyService).useClass(AppPolicyService).asSingleton();
```

### Evaluate at call sites

```ts
const policyService = container.get(PolicyService);

// `check` returns the discriminated result — branch on `allowed`.
const result = await policyService.check('email_allowed', { value: 'user@example.com' });
if (!result.allowed) {
  throw httpError(400).withDetails({ value: result.reason });
}

// `assert` throws HTTP 403 (with `kind: 'policy_violation'` in internal details) on deny.
await policyService.assert('email_allowed', { value: 'user@example.com' });
```

### Step-up denials

When a policy needs proof of recent re-authentication, return a step-up denial. The bundled `StepUpRequirement` is serialised under `details.stepUp` so clients can drive the user through a re-auth challenge before retrying:

```ts
return this.denyStepUp('recent_auth_required', {
  within: Duration.fromObject({ minutes: 5 }),
  acceptableMethods: ['fido', 'authenticator'],
});
```

## API

### `Policy<Context, Envelope>`

Abstract base class. Subclass and implement `evaluate(context, envelope): Promise<PolicyResult>`.

| Helper                             | Returns                                                            | Description                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `allow()`                          | `{ allowed: true }`                                                | Allow the request                                                                                    |
| `deny(reason, details?)`           | `{ allowed: false, reason, details? }`                             | Deny with a machine-readable reason and optional structured details                                  |
| `denyStepUp(reason, requirement)`  | `{ allowed: false, reason, details: { kind: 'step_up_required', stepUp } }` | Deny and attach a `StepUpRequirement` clients can use to drive a re-auth challenge                   |

### `PolicyService`

Abstract DI handle. Implementations supply a per-evaluation envelope.

| Method                                   | Returns                  | Description                                                                                              |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `check(policyName, context)`             | `Promise<PolicyResult>`  | Resolve the registered policy and return its result. Throws when `policyName` is not registered.         |
| `assert(policyName, context)`            | `Promise<void>`          | Same as `check`, but throws HTTP 403 (`kind: 'policy_violation'`) on deny.                               |

### `BasePolicyService<TPolicies, TEnvelope>`

Default `PolicyService`. Subclass and implement `buildEnvelope(): Promise<TEnvelope>`. The `TPolicies` type parameter ties policy names to their context shape, giving call sites compile-time type safety.

### `PolicyRegistryMap`

`Map<string, Identifier<Policy>>`. Populate at bootstrap to bind each policy name to its DI identifier.

### Types

| Type                  | Shape                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `PolicyResultAllowed` | `{ allowed: true }`                                                                                    |
| `PolicyResultDenied`  | `{ allowed: false; reason: string; details?: Record<string, unknown> }`                                |
| `PolicyResult`        | `PolicyResultAllowed \| PolicyResultDenied`                                                            |
| `PolicyEnvelope`      | `{ now: DateTime }` (extend in subclasses)                                                             |
| `StepUpRequirement`   | `{ within: Duration; acceptableMethods?; acceptableKinds?; excludeMethods? }`                          |

| Guard                       | Description                                  |
| --------------------------- | -------------------------------------------- |
| `isPolicyResultAllowed(r)`  | Narrows `r` to the allowed branch.           |
| `isPolicyResultDenied(r)`   | Narrows `r` to the denied branch.            |
