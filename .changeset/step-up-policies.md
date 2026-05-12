---
'@maroonedsoftware/authentication': minor
---

Adds two step-up policies that close the loop on the helpers already exported
from this package (`matchesFactorConstraints`, `isFactorRecent`) and the
`StepUpRequirement` shape from `@maroonedsoftware/policies`.

- **`'auth.recent.factor'`** — `DefaultRecentFactorPolicy`. Generic step-up
  rule: allows when at least one factor in `context.factors` matches the
  supplied constraints (`anyOfKinds`, `anyOfMethods`, `excludeMethods`) and
  was re-verified within `context.within` of `envelope.now`. Denies with an
  embedded `StepUpRequirement` so clients can drive the right re-auth.
- **`'auth.assurance.level'`** — `DefaultAssuranceLevelPolicy`. NIST 800-63B-
  style AAL1/AAL2 check. AAL1 allows when any one factor is fresh enough;
  AAL2 allows when the session has knowledge + possession/biometric, or two
  distinct non-knowledge factors (passwordless path, distinctness keyed on
  `(method, methodId)`). On deny, the `acceptableKinds` in the embedded
  step-up requirement points the client at the kinds that would actually
  raise the session to the target AAL.

Both policies are agnostic to the consumer's actor model — callers pass
`factors` through the policy `context` rather than the envelope. Gate on
actor kind (e.g. reject non-human actors) at the call site or in a wrapping
subclass.

Both are registered in `AuthenticationPolicyMappings` and surfaced via
`AuthenticationPolicyContexts` for compile-time `policyService.check` type
safety, matching the convention used by `DefaultMfaRequiredPolicy`.
