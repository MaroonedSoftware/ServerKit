---
'@maroonedsoftware/slack': minor
'@maroonedsoftware/johnny5': minor
---

Move to @slack/web-api v8 (slack) and execa v10 (johnny5). Both SDKs' types appear in the public API — `SlackClient`'s argument/response types and `Shell`'s `ShellOptions`/`ResultPromise` — so consumers typed against the old SDK shapes may need to update; `ShellOptions` is now a type alias rather than an interface.
