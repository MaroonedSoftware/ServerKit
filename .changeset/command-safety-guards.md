---
'@maroonedsoftware/johnny5': minor
---

Add declarative safety guards to `CommandModule`:

- `dangerous: true` (or `{ confirm: 'typed', phrase, message }`) marks a command as destructive. johnny5 auto-injects a `-y, --yes` flag (skipped when one is already declared), prompts the user in TTY contexts, requires `--yes` in non-interactive contexts, and supports a typed-phrase confirmation mode for the most dangerous operations.
- `allowedEnvironments: ['development', 'staging']` (or the spec form `{ allowed, variable }`) refuses to run when the configured env variable falls outside the allowed list. Defaults to reading `NODE_ENV`. The env guard runs before the dangerous prompt, so misconfigured environments fail fast.

`DangerousSpec` and `EnvironmentGuardSpec` are now exported from the package root for callers that want to type these specs themselves.
