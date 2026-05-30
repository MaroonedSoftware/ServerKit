---
'@maroonedsoftware/appconfig': minor
---

Add `AppConfigProviderAwsSecrets`, a provider that resolves `${aws:SECRET_ID}` references against AWS Secrets Manager. Mirrors the GCP provider: an optional `region` (resolved from the standard AWS provider chain when omitted) and an optional `prefix` regex. Supports both `SecretString` and `SecretBinary` secrets, attempts to JSON-parse resolved values, and throws a `ServerkitError` (rather than silently substituting an empty string) when a secret cannot be resolved. Requires the new `@aws-sdk/client-secrets-manager` peer dependency.
