---
'@maroonedsoftware/authentication': minor
---

Add `OtpProviderMock`, a drop-in replacement for `OtpProvider` for local development and integration tests. `generate` always returns `'000000'`, `validate` always returns `true`, and every call logs a warning to the injected `Logger`. Never register in production.
