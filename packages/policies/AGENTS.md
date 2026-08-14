# AGENTS.md — @maroonedsoftware/policies

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Allow/deny rules as named, injectable classes. A `Policy` returns a discriminated `PolicyResult`
(`{ allowed: true }` or `{ allowed: false, reason, details?, internalDetails?, headers? }`) instead
of throwing, so callers get a machine-readable reason they can branch on. `PolicyService.check()`
returns the result; `PolicyService.assert()` throws an `HttpError` (403 by default) when denied,
splitting the denial across `details`, `internalDetails`, and response headers.

Reach for this when the question is a stateless rule about the current request: is this email
domain allowed, is this session MFA-satisfied, is this account locked. Do **not** reach for it when
the answer depends on stored relationships between objects and subjects — that is
`@maroonedsoftware/permissions`. The two compose: a `Policy` can call `check()` from `permissions`.

## Install

```bash
pnpm add @maroonedsoftware/policies
```

Runtime dependencies: `@maroonedsoftware/errors`, `injectkit`, `luxon`.

## Position in the graph

- **Depends on:** `errors`.
- **Depended on by:** `authentication`, `koa` (`requirePolicy`), `mcp` (bearer auth), `discord`,
  `slack`, `telegram`, `whatsapp`, `johnny5`.
- **Subpath exports:** none. The package has no `exports` map at all.

## API surface

### Results

| Export                  | Kind       | Shape                                                                      | Notes                                                               |
| ----------------------- | ---------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `PolicyResult`          | type       | `PolicyResultAllowed \| PolicyResultDenied`                                | Discriminated on `allowed`.                                         |
| `PolicyResultAllowed`   | type       | `{ allowed: true }`                                                        | —                                                                   |
| `PolicyResultDenied`    | type       | `{ allowed: false; reason: string; details?; internalDetails?; headers? }` | `reason` is machine-readable (`'deny_list'`, `'mfa_required'`).     |
| `PolicyDenialBuilder`   | class      | Implements `PolicyResultDenied`, plus `withHeaders(headers) => this`       | Returned by `deny()` / `denyStepUp()`. Usable directly as a result. |
| `isPolicyResultAllowed` | type guard | `(result: PolicyResult) => result is PolicyResultAllowed`                  | —                                                                   |
| `isPolicyResultDenied`  | type guard | `(result: PolicyResult) => result is PolicyResultDenied`                   | —                                                                   |

### Policy

| Export                      | Kind             | Shape                                                                          | Notes                                                                     |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `Policy<Context, Envelope>` | abstract class   | `@Injectable()`, `abstract evaluate(context, envelope): Promise<PolicyResult>` | Defaults: `Context = PolicyContext`, `Envelope = PolicyEnvelope`.         |
| `Policy#allow`              | protected method | `() => PolicyResultAllowed`                                                    | —                                                                         |
| `Policy#deny`               | protected method | `(reason: string, details?, internalDetails?) => PolicyDenialBuilder`          | `details` reach the client; `internalDetails` do not.                     |
| `Policy#denyStepUp`         | protected method | `(reason: string, requirement: StepUpRequirement) => PolicyDenialBuilder`      | Sets `details = { kind: 'step_up_required', stepUp: requirement }`.       |
| `PolicyContext`             | interface        | `{}` — a marker                                                                | Define a concrete shape and pass it as the type parameter.                |
| `PolicyEnvelope`            | interface        | `{ now: DateTime }`                                                            | Extend it in your subclass to carry session, request id, flags.           |
| `StepUpRequirement`         | interface        | `{ within: Duration; acceptableMethods?; acceptableKinds?; excludeMethods? }`  | At least one factor must match and have been re-verified within `within`. |

### Service

| Export                                    | Kind           | Shape                                                                                                                            | Notes                                                               |
| ----------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Policies<Name>`                          | type           | `Record<Name, PolicyContext>`                                                                                                    | Ties each policy name to the context shape it needs.                |
| `PolicyRegistryMap`                       | class          | `@Injectable() extends Map<string, Identifier<Policy>>`                                                                          | Name → DI identifier. Populated at bootstrap.                       |
| `PolicyService`                           | abstract class | `check(policyName, context)`, `assert(policyName, context, statusCode?)`                                                         | The DI token to depend on. Untyped at this level, by design.        |
| `BasePolicyService<TPolicies, TEnvelope>` | abstract class | `constructor(container: Container, policyRegistry: PolicyRegistryMap)`, `protected abstract buildEnvelope(): Promise<TEnvelope>` | The implementation. `check`/`assert` are typed against `TPolicies`. |
| `AlwaysAllowPolicy`                       | class          | Always `{ allowed: true }`                                                                                                       | Tests and local development only.                                   |
| `AlwaysDenyPolicy`                        | class          | Always `{ allowed: false, reason: 'always_deny' }`                                                                               | Tests only. Carries no `details`.                                   |

`assert` maps a denial to `httpError(statusCode ?? 403)` with:

- `result.details` → `HttpError.details` (rendered to the response body)
- `result.internalDetails`, merged with `{ message, policyName, reason, kind: 'policy_violation' }`
  → `HttpError.internalDetails` (logged only)
- `result.headers` → `HttpError.withHeaders`

## Canonical usage

```typescript
import { Injectable, Container } from 'injectkit';
import { DateTime } from 'luxon';
import { Policy, BasePolicyService, PolicyRegistryMap, type PolicyEnvelope, type PolicyResult } from '@maroonedsoftware/policies';

type EmailContext = { value: string };

type AppPolicies = {
  'email.allowed': EmailContext;
  'auth.session.mfa.satisfied': { session: AuthenticationSession };
};

@Injectable()
class EmailAllowedPolicy extends Policy<EmailContext> {
  constructor(private readonly config: EmailPolicyConfig) {
    super();
  }

  async evaluate(context: EmailContext): Promise<PolicyResult> {
    const domain = context.value.split('@')[1];
    if (!domain) return this.deny('invalid_format');
    if (this.config.blockedDomains.includes(domain)) {
      return this.deny('deny_list', { domain }, { blocklistVersion: this.config.version });
    }
    return this.allow();
  }
}

@Injectable()
class AppPolicyService extends BasePolicyService<AppPolicies> {
  constructor(container: Container, registry: PolicyRegistryMap) {
    super(container, registry);
  }

  protected async buildEnvelope(): Promise<PolicyEnvelope> {
    return { now: DateTime.utc() };
  }
}

// Composition root
const policies = new PolicyRegistryMap();
policies.set('email.allowed', EmailAllowedPolicy);

registry.register(PolicyRegistryMap).useValue(policies);
registry.register(EmailAllowedPolicy).useClass(EmailAllowedPolicy);
registry.register(PolicyService).useClass(AppPolicyService);

// Call site
await container.get(PolicyService).assert('email.allowed', { value: email });
```

In a Koa router, prefer the `requirePolicy` middleware from `@maroonedsoftware/koa` over calling
`assert` by hand.

## Rules for generated code

- Policy names are catalog keys: dot notation, no hyphens (`auth.session.mfa.satisfied`,
  `email.allowed`).
- **Never throw from `evaluate` to signal a denial.** Return `this.deny(...)`. A throw bypasses
  the whole result contract, so `check()` callers cannot branch and `assert()` cannot attach
  headers or details.
- `reason` is a stable machine-readable token that clients and tests branch on. It is not a
  user-facing message, so no sentences and no interpolated values.
- Put client-safe hints in `details` and everything else in `internalDetails`. `assert` renders
  `details` into the response body verbatim.
- Depend on the abstract `PolicyService`, never on your `BasePolicyService` subclass. That is the
  seam that lets an app swap in its own envelope.
- Declare a `Policies` map and pass it to `BasePolicyService` so `check`/`assert` are typed per
  policy name. Without it you get `PolicyContext` (`{}`) at every call site and no checking.
- Build the envelope with `DateTime.utc()`, never `new Date()`.
- Use `denyStepUp(reason, requirement)` for re-auth gates rather than hand-rolling the
  `step_up_required` payload — clients key off that exact shape.
- Pass an explicit `statusCode` to `assert` when 403 is wrong (401 for an unauthenticated request
  signature, 429 for rate limits).

## Gotchas

- **`assert` throws 403 by default, not 401.** A policy that fails because the caller is
  unauthenticated needs `assert(name, ctx, 401)`, otherwise the client is told "forbidden" when it
  should be told to authenticate.
- **`buildEnvelope()` runs once per `check`, not once per request.** Two `assert` calls in one
  request build two envelopes with two different `now` values. If policies must agree on `now`,
  cache it on the request-scoped service instance.
- **`PolicyService` (the abstract token) is untyped.** `check(policyName: string, context: PolicyContext)`
  accepts anything. The compile-time safety lives on `BasePolicyService<TPolicies>`, so a call site
  that depends on the abstract token gets no per-name checking. That is the deliberate trade for
  keeping the DI token stable.
- **An unknown policy name throws a plain `Error`, not an `HttpError`.** `errorMiddleware` renders
  it as a generic 500 with no details. A typo in a `PolicyRegistryMap` key surfaces as an opaque
  server error at runtime, not at compile time.
- **`AlwaysAllowPolicy` is not universally "the permissive direction".** For
  `auth.session.mfa.required`, a _denial_ means MFA is required, so always-allow skips the
  challenge. For `auth.session.mfa.satisfied`, an _allow_ asserts the session already stepped up.
  Read which way the policy you are overriding is phrased, and gate the binding behind a flag that
  cannot be set in production.
- **`AlwaysDenyPolicy` carries no `details`.** Callers that read the denial payload (an MFA
  orchestrator reading `details.eligibleFactors`, say) get an empty result rather than a failure,
  which can produce an unsatisfiable challenge instead of a clean error. Write a purpose-built stub
  when the call site depends on the denial's shape.
- **`withHeaders` replaces the whole map**, matching `HttpError.withHeaders` semantics.

## Working inside this package

```
src/
  policy.ts               PolicyResult types, PolicyDenialBuilder, guards, PolicyEnvelope,
                          StepUpRequirement, the Policy base class
  policy.service.ts       Policies, PolicyRegistryMap, PolicyService, BasePolicyService
  always.allow.policy.ts  AlwaysAllowPolicy
  always.deny.policy.ts   AlwaysDenyPolicy
  index.ts                Barrel
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- `Policy`, `PolicyService`, and `PolicyRegistryMap` must stay classes (abstract or `Map`
  subclasses), not interfaces or type aliases, or they stop working as InjectKit tokens.
- `evaluate` returns results and never throws for a denial. Every consumer's error handling
  assumes it.
- The `assert` mapping of `details` / `internalDetails` / `headers` onto `HttpError` is a contract
  shared with `errorMiddleware` in `@maroonedsoftware/koa`. Changing which payload goes where is a
  data-exposure change.
- The `{ kind: 'step_up_required', stepUp: … }` shape is consumed by clients and by
  `@maroonedsoftware/authentication`. Do not rename its fields.
- `errors` is the only internal dependency. Keep it that way — `authentication` depends on this
  package, so a dependency in the other direction would be a cycle.

User-visible changes need a changeset in `.changeset/`.
